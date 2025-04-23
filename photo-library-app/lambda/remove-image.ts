import { SQSEvent } from 'aws-lambda';
import { S3 } from 'aws-sdk';

const s3 = new S3();
const bucketName = process.env.BUCKET_NAME;

if (!bucketName) {
    throw new Error('BUCKET_NAME environment variable is not set.');
}

export const handler = async (event: SQSEvent): Promise<void> => {
    for (const record of event.Records) {
        try {
            const body = JSON.parse(record.body);
            const s3Record = body?.Records?.[0]?.s3;

            if (!s3Record || !s3Record.object?.key) {
                console.warn('Missing S3 object key in record:', record.body);
                continue;
            }

            const rawKey = s3Record.object.key;
            const key = decodeURIComponent(rawKey.replace(/\+/g, ' '));

            await s3.deleteObject({
                Bucket: bucketName,
                Key: key,
            }).promise();

            console.log(`Successfully deleted file: ${key}`);
        } catch (error) {
            console.error(`Failed to process SQS record: ${record.body}`, error);
        }
    }
};
