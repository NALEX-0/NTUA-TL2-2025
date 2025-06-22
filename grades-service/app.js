const db = require('./models');

const axios = require('axios');
const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const ExcelJS = require('exceljs');
const app = express();
const PORT = process.env.PORT || 3000;
const upload = multer({ dest: 'uploads/' });
const authenticateJWT = require('./middlewares/authenticateJWT');
const requestTeacherInstitution = require('./requestTeacherInstitution');

app.use(express.json()); 

if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// docker-compose -p clearsky up --build
app.post('/grades/upload', authenticateJWT, upload.single('file'), async (req, res) => {
  const file = req.file;

  const user = req.user;
  
  const instructor_id = user.teacherId;

  if (user.role !== 'INSTRUCTOR') {
    return res.status(403).json({ error: 'Only instructors can upload grades' });
  }

  if (!file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  
  const uid = uuidv4();
  const fileBuffer = fs.readFileSync(file.path);

  let course = 'Unknown Course';
  let period = 'Unknown Period';
  let number_grades = 0;

  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(file.path);
    const worksheet = workbook.getWorksheet(1);

    course = worksheet.getCell('E4').value || 'Unknown Course';
    period = worksheet.getCell('D4').value || 'Unknown Period';

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber >= 4) {
        const isNotEmpty = row.values.some((v, i) => i > 0 && v !== null && v !== '');
        if (isNotEmpty) number_grades++;
      }
    });

  } catch (err) {
    console.error('Excel read error:', err);
  }

  try {
    await db.uploads.create({
      uid: uid,
      file: fileBuffer
    });

    await db.logs.create({
      uid,
      teacher_id: instructor_id,
      action: 'upload',
      message: `Upload with uid ${uid} by instructor_id: ${instructor_id}`
    });

    res.json({
      course,
      period,
      number_grades,
      uid
    });
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: 'Database insert failed' });
  } finally {
    fs.unlinkSync(file.path);
  }
});


app.post('/grades/confirm', authenticateJWT, async (req, res) => {
  const { uid } = req.body;

  const user = req.user;
  
  const instructor_id = user.teacherId;

  if (!uid || !instructor_id) {
    return res.status(400).json({
      success: false,
      message: 'Missing uid or instructor_id'
    });
  }


  const t = await db.sequelize.transaction();
  // const t = await sequelize.transaction();
  try {
    const upload = await db.uploads.findOne({ where: { uid }, transaction: t });
    if (!upload) {
      await t.rollback();
      return res.status(404).json({
        success: false,
        message: 'Upload not found',
      });
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(upload.file);
    const worksheet = workbook.worksheets[0];

    const course = worksheet.getCell('E4').value || 'Unknown Course';
    const semester = worksheet.getCell('D4').value || 'Unknown Semester';

    const exam = await db.examinations.create({
      teacher_id: instructor_id,
      course,
      semester,
    }, { transaction: t });

    const studentAMs = [];
    const gradesData = [];

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber >= 4) {
        const amCell = row.getCell(1);
        const am = amCell?.value?.toString()?.trim();
        if (am) {
          studentAMs.push(am);
          gradesData.push({ am, row });
        }
      }
    });

    const studentRecords = await db.students.findAll({
      where: { am: studentAMs },
      transaction: t,
    });

    const studentMap = new Map();
    studentRecords.forEach(student => {
      studentMap.set(student.am, student.id);
    });

    for (const entry of gradesData) {
      const studentId = studentMap.get(entry.am);
      if (!studentId) continue;

      const gradeCell = entry.row.getCell(7);
      const gradeValue = gradeCell?.value;

      await db.grades.create({
        student_id: studentId,
        examination_id: exam.id,
        value: parseInt(gradeValue),
        state: 'Open',
      }, { transaction: t });
    }

    await db.logs.create({
      uid,
      teacher_id: instructor_id,
      action: 'confirm',
      message: `Grades confirmed by instructor: ${instructor_id}`,
    }, { transaction: t });


    const id_response = await requestTeacherInstitution(instructor_id);
    const id = id_response?.[0]?.institution_id ?? null;

    const response = await axios.get(`http://institution-service:3000/institutions/${id}/credits`);
    const tokens = response.data.tokens;


    if (tokens <= 0) {
      throw new Error("Error: not enough tokens");
    }

    await axios.post(`http://institution-service:3000/institutions/${id}/credits/consume`, {
      amount: 1
    });

    await t.commit();
    res.json({
      success: true,
      message: `Grades confirmed by instructor: ${instructor_id}`,
    });

  } catch (error) {
    await t.rollback();
    console.error('Operation failed:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }

});


app.post('/grades/cancel', authenticateJWT, async (req, res) => {
  const { uid } = req.body;

  const user = req.user;
  
  const instructor_id = user.teacherId;

  if (!uid || !instructor_id) {
    return res.status(400).json({
      success: false,
      message: 'Missing uid or instructor_id'
    });
  }

  try {
    const upload = await db.uploads.findOne({ where: { uid } });

    if (!upload) {
      return res.status(404).json({
        success: false,
        message: 'No upload found with the given uid'
      });
    }

    await upload.destroy();

    await db.logs.create({
      uid,
      teacher_id: instructor_id,
      action: 'cancel',
      message: `Upload with uid ${uid} has been canceled by instructor_id: ${instructor_id}`
    });

    return res.json({
      success: true,
      message: `Upload with uid ${uid} has been canceled by instructor_id: ${instructor_id}`
    });

  } catch (err) {
    console.error('Error cancelling upload:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});


app.get('/grades/student', async (req, res) => {
  const { student_id, state } = req.query;

  if (!student_id) {
    return res.status(400).json({ error: 'Missing student_id' });
  }

  try {
    if (!state) {
      var grades = await db.grades.findAll({
        where: { student_id },
        attributes: ['value']
      });
    }

    else {
      var grades = await db.grades.findAll({
        where: {
          student_id,
          state: state
        },
        attributes: ['value']
      });
    }

    const values = grades.map(grade => grade.value);

    res.json(values);

  } catch (err) {
    console.error('Error fetching grade values:', err);
    res.status(500).json({ error: 'Internal server error' });
  }

});


app.get('/grades/examination', async (req, res) => {
  const { examination_id } = req.query;

  if (!examination_id) {
    return res.status(400).json({ error: 'Missing examination_id' });
  }
  try {
    const grades = await db.grades.findAll({
      where: { examination_id },
      attributes: ['value']
    });

    // (Ask) Maybe change, depends on what data structure frontend needs
    const values = grades.map(grade => grade.value);

    res.json(values);

  } catch (err) {
    console.error('Error fetching grade values:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});


app.get('/grades/instructor-examinations', async (req, res) => {
  const { id, role } = req.query;

  if (!id) {
    return res.status(400).json({ error: 'Missing id' });
  }
  if (!role) {
    return res.status(400).json({ error: 'Missing role' });
  }

  try {
    if (role == "student") {
      const grades = await db.grades.findAll({
        where: { student_id: id },
        attributes: ['examination_id']
      });

      const examIds = [...new Set(grades.map(g => g.examination_id))];

      const exams = await db.examinations.findAll({
        where: { id: examIds },
        attributes: ['course']
      });

      const courses = exams.map(e => e.course);
      res.json(courses);
    }

    if (role == "teacher") {
      
      var exams = await db.examinations.findAll({
        where: { teacher_id: id },
        attributes: ['course']
      });

      var values = exams.map(exam => exam.course);

      res.json(values);

    }
  } catch (err) {
    console.error('Error fetching examinations:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = async function startHttpServer() {
  app.listen(PORT, () => {
    console.log(`Grades HTTP API running on port ${PORT}`);
  });
};