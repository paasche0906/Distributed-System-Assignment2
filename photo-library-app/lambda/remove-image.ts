import { SQSEvent } from 'aws-lambda';
import * as AWS from 'aws-sdk';

const s3 = new AWS.S3();
const bucketName = process.env.BUCKET_NAME!;

export const handler = async (event: SQSEvent): Promise<void> => {
    console.log('Received event:', JSON.stringify(event, null, 2));

    for (const record of event.Records) {
        const messageBody = JSON.parse(record.body);
        const snsMessage = JSON.parse(messageBody.Message);
        const fileName = snsMessage.Records[0].s3.object.key;

        try {
            await s3.deleteObject({
                Bucket: bucketName,
                Key: fileName,
            }).promise();
            console.log(`Deleted invalid file: ${fileName}`);
        } catch (error) {
            console.error(`Failed to delete ${fileName}:`, error);
        }
    }
};
