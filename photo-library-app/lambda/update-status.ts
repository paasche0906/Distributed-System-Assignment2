import { SNSEvent } from 'aws-lambda';
import * as AWS from 'aws-sdk';

const ddb = new AWS.DynamoDB.DocumentClient();
const tableName = process.env.TABLE_NAME!;

export const handler = async (event: SNSEvent): Promise<void> => {
    console.log('Received event:', JSON.stringify(event, null, 2));

    for (const record of event.Records) {
        const message = JSON.parse(record.Sns.Message);

        const imageId = message.id;
        const status = message.update.status;
        const reason = message.update.reason;

        if (!['Pass', 'Reject'].includes(status)) {
            console.error('Invalid status value');
            throw new Error('Invalid status value');
        }

        await ddb.update({
            TableName: tableName,
            Key: { id: imageId },
            UpdateExpression: 'set #s = :status, reason = :reason',
            ExpressionAttributeNames: {
                '#s': 'status',
            },
            ExpressionAttributeValues: {
                ':status': status,
                ':reason': reason,
            },
        }).promise();

        console.log(`Status ${status} updated for ${imageId}`);
    }
};
