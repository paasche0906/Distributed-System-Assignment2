import { SNSEvent } from 'aws-lambda';
import * as AWS from 'aws-sdk';

const ddb = new AWS.DynamoDB.DocumentClient();
const tableName = process.env.TABLE_NAME!;

export const handler = async (event: SNSEvent): Promise<void> => {
  console.log('Received event:', JSON.stringify(event, null, 2));

  for (const record of event.Records) {
    const message = JSON.parse(record.Sns.Message);
    const fileName: string = message.Records[0].s3.object.key;

    if (!fileName.endsWith('.jpeg') && !fileName.endsWith('.png')) {
      console.error(`Invalid file type: ${fileName}`);
      throw new Error('Invalid file type');
    }

    await ddb.put({
      TableName: tableName,
      Item: {
        id: fileName
      }
    }).promise();

    console.log(`Image ${fileName} logged successfully.`);
  }
};
