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

    await channel.assertQueue('teacherInstitution.request', { durable: false });

    channel.consume('teacherInstitution.request', async (msg) => { 
        const request = JSON.parse(msg.content.toString()); 
        console.log('Received institution_id request for teacher:', request.teacher_id);

        try {
            // const institutionId = await db.teachers.findByPk(request.teacher_id, {
            //     attributes: ['institution_id']}
            // );
            const institutionId = await db.teachers.findAll({
                where: {
                    id: request.teacher_id
                },
                attributes: ['institution_id']
            });

            console.log('Found institution_id:', institutionId);

            const responsePayload = Buffer.from(JSON.stringify({ institutionId }));

            channel.sendToQueue(msg.properties.replyTo, responsePayload, {
                correlationId: msg.properties.correlationId
            });

            channel.ack(msg);
        } catch (error) {
            console.error('Failed to fetch grades from DB:', error);
            channel.ack(msg);
        }
    });
}
