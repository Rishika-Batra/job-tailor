import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const tableName = process.env.TABLE;

export const handler = async (event) => {
  const { jobId, status } = event;

  if (!jobId || !status) {
    console.error("Missing jobId or status in event", event);
    throw new Error("Missing jobId or status");
  }

  await docClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { jobId },
      UpdateExpression: "SET #st = :status",
      ExpressionAttributeNames: {
        "#st": "status",
      },
      ExpressionAttributeValues: {
        ":status": status,
      },
    })
  );

  return { jobId, status };
};
