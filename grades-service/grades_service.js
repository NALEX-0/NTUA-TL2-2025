const amqp = require('amqplib');
const db = require('./models');

const amqpUrl = process.env.RABBITMQ_URL;

async function waitForRabbitMQ(url, retries = 30, delay = 3000) {
  for (let i = 0; i < retries; i++) {
    try {
      const connection = await amqp.connect(url);
      return connection;
    } catch (err) {
      console.log(`RabbitMQ not ready (attempt ${i + 1}/${retries}). Retrying in ${delay}ms...`);
      await new Promise(res => setTimeout(res, delay));
    }
  }
  throw new Error(`Unable to connect to RabbitMQ after ${retries} attempts`);
}


module.exports = async function startMessageListener() {
  const connection = await waitForRabbitMQ(amqpUrl);
  const channel = await connection.createChannel();

  await channel.assertQueue('grades.request', { durable: false });
  channel.assertQueue('grades.enrollments.request', { durable: false });

  channel.consume('grades.request', async (msg) => { 
    const request = JSON.parse(msg.content.toString());
    console.log('Received grade request for exam:', request.examination_id);

    try {
      const grades = await db.grades.findAll({
        where: {
          examination_id: request.examination_id
        },
        attributes: ['value']
      });

      console.log(grades);

      const responsePayload = Buffer.from(JSON.stringify({ grades }));

      channel.sendToQueue(msg.properties.replyTo, responsePayload, {
        correlationId: msg.properties.correlationId
      });

      channel.ack(msg);
    } catch (error) {
      console.error('Failed to fetch grades from DB:', error);
      channel.ack(msg); // Still acknowledge to avoid retry loop
    }
  });

  channel.consume('grades.enrollments.request', async (msg) => {
    const request = JSON.parse(msg.content.toString());
    console.log('Received enrollment request for student:', request.student_id);

    try {
      const enrolledExams = await db.grades.findAll({
        where: {
          student_id: request.student_id
        },
        attributes: ['examination_id']
      });

      const responsePayload = Buffer.from(JSON.stringify({ enrolled_exams: enrolledExams }));

      channel.sendToQueue(msg.properties.replyTo, responsePayload, {
        correlationId: msg.properties.correlationId
      });

      channel.ack(msg);
    } catch (error) {
      console.error('DB query failed (enrollments):', error);
      channel.ack(msg); // Acknowledge even on failure
    }
  });


  channel.assertQueue('grades.student.request', { durable: false });

  channel.consume('grades.student.request', async (msg) => {
    const request = JSON.parse(msg.content.toString());
    console.log('Received student grades request for student_id:', request.student_id);

    try {
      const studentGrades = await db.grades.findAll({
        where: { student_id: request.student_id },
        attributes: ['id', 'value']
      });

      const result = studentGrades.map(g => ({
        gradeId: g.id,
        grade: g.value
      }));

      const responsePayload = Buffer.from(JSON.stringify({ grades: result }));

      channel.sendToQueue(msg.properties.replyTo, responsePayload, {
        correlationId: msg.properties.correlationId
      });

      channel.ack(msg);
    } catch (error) {
      console.error('Failed to fetch grades by student_id:', error);
      channel.ack(msg);
    }
  });


  console.log('Grades service is waiting for requests...');
}
