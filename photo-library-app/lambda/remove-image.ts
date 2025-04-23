import { SQSEvent } from 'aws-lambda';
import * as AWS from 'aws-sdk';

const s3 = new AWS.S3();
const bucketName = process.env.BUCKET_NAME!;

export const handler = async (event: SQSEvent): Promise<void> => {
    console.log('Processing DLQ event:', JSON.stringify(event, null, 2));

    for (const record of event.Records) {
        try {
            const messageBody = JSON.parse(record.body);
            const snsMessage = JSON.parse(messageBody.Message);
            const fileName = snsMessage.Records[0].s3.object.key;

            await s3.deleteObject({
                Bucket: bucketName,
                Key: fileName,
            }).promise();

            console.log(`Deleted invalid file: ${fileName}`);
        } catch (error) {
            console.error('Failed to delete file from S3:', error);
        }
    }
};
