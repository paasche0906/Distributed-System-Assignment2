import { SQSEvent } from 'aws-lambda';
import * as AWS from 'aws-sdk';

const ddb = new AWS.DynamoDB.DocumentClient();
const tableName = process.env.TABLE_NAME!;

export const handler = async (event: SQSEvent): Promise<void> => {
  console.log('Received event:', JSON.stringify(event, null, 2));

  for (const record of event.Records) {
    try {
      const messageBody = JSON.parse(record.body);
      const snsMessage = JSON.parse(messageBody.Message);
      const fileName: string = snsMessage.Records[0].s3.object.key;
      const normalizedFileName = fileName.toLowerCase();

      if (!normalizedFileName.endsWith('.jpeg') && !normalizedFileName.endsWith('.png')) {
        console.error(`Invalid file type: ${fileName}`);
        throw new Error('Invalid file type');
      }

      await ddb.put({
        TableName: tableName,
        Item: { id: fileName }
      }).promise();

      console.log(`✅ Image ${fileName} logged successfully.`);

    } catch (error) {
      console.error(`🔥 Error processing message: ${error}`);
      throw error;
    }
  }
};
