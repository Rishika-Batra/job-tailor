import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const tableName = process.env.TABLE;

export const handler = async (event) => {
  const authorizer = event.requestContext?.authorizer;
  const userId = authorizer?.claims?.sub || authorizer?.jwt?.claims?.sub;
  if (!userId) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: "Unauthorized" }),
    };
  }

  // Note: DynamoDB Scan does not scale well as the table grows.
  // For multi-user support, this should move to a Query against a
  // GSI keyed on userId (or another partition scoped to the caller)
  // rather than scanning the whole table.
  const scanResult = await docClient.send(
    new ScanCommand({
      TableName: tableName,
      FilterExpression: '#st = :complete AND userId = :userId',
      ExpressionAttributeNames: { '#st': 'status' },
      ExpressionAttributeValues: { 
        ':complete': 'complete',
        ':userId': userId
      }
    })
  );

  const items = (scanResult.Items || [])
    .map((item) => ({
      jobId: item.jobId,
      matchScore: item.matchScore ?? null,
      completedAt: item.completedAt ?? null,
      jdSnippet: item.jdSnippet ?? null
    }))
    .sort((a, b) => {
      if (!a.completedAt) return 1;
      if (!b.completedAt) return -1;
      return b.completedAt.localeCompare(a.completedAt);
    });

  return {
    statusCode: 200,
    body: JSON.stringify({ jobs: items })
  };
};
