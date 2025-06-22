const app = require('./review.js');
const amqp = require('amqplib');
const PORT = process.env.PORT || 3000;
const amqpUrl = process.env.RABBITMQ_URL;

async function waitForRabbitMQ(url, retries = 30, delay = 3000) {
  for (let i = 0; i < retries; i++) {
    try {
        console.log(`Attempting to connect to RabbitMQ at ${url}...`);
      const connection = await amqp.connect(url);
      return connection;
    } catch (err) {
      console.log(`RabbitMQ not ready (attempt ${i + 1}/${retries}). Retrying in ${delay}ms...`);
      await new Promise(res => setTimeout(res, delay));
    }
  }
  throw new Error(`Unable to connect to RabbitMQ after ${retries} attempts`);
}


waitForRabbitMQ(amqpUrl).then(() => {
    app.listen(PORT, () => {
        console.log(`Review service running on port ${PORT}`);
    });
}); 