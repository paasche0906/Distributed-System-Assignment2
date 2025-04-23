import { SQSEvent } from 'aws-lambda';
import { DynamoDB } from 'aws-sdk';

const dynamodb = new DynamoDB.DocumentClient();
const tableName = process.env.TABLE_NAME;

if (!tableName) {
  throw new Error('TABLE_NAME environment variable is not defined.');
}

export const handler = async (event: SQSEvent): Promise<void> => {
  console.log('Received SQS Event:', JSON.stringify(event, null, 2));

  for (const record of event.Records) {
    try {
      const body = JSON.parse(record.body);
      const s3Record = body?.Records?.[0]?.s3;

      if (!s3Record || !s3Record.object?.key) {
        console.warn('S3 record is missing or malformed:', record.body);
        continue;
      }

      const rawKey = s3Record.object.key;
      const key = decodeURIComponent(rawKey.replace(/\+/g, ' '));

      if (!/\.(jpeg|png)$/i.test(key)) {
        console.warn(`Invalid file type for key: ${key}`);
        continue;
      }

      await dynamodb.put({
        TableName: tableName,
        Item: { id: key },
      }).promise();

      console.log(`✅ Successfully logged image: ${key}`);
    } catch (error) {
      console.error('Failed to process record:', record.body, error);
    }
  }
};
