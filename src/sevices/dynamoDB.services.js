import {DynamoDBClient} from "@aws-sdk/client-dynamodb";
import {
    DynamoDBDocumentClient,
    GetCommand,
    PutCommand,
    UpdateCommand,
    DeleteCommand,
} from "@aws-sdk/lib-dynamodb";

const USERS_TABLE = process.env.USERS_TABLE;
if(!USERS_TABLE) throw new Error("Missing env USERS_TABLE");

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export async function getUser(userId){
    const res = await ddb.send(new GetCommand({
        TableName: USERS_TABLE,
        Key: {UserId: userId},
    }));
    return res.Item;
}

export async function createUser(item){
    await ddb.send(new PutCommand({
        TableName: USERS_TABLE,
        Item: item,
    }));
}

export async function updateUser(userId, updates){
    const exprNames = {};
    const exprValues = {};
    const setParts = [];

    let i = 0;
    for(const [key, value] of Object.entries(updates)){
        i += 1; // Increment only once
        const nameKey = `#key${i}`;
        const valueKey = `:value${i}`;
        exprNames[nameKey] = key;
        exprValues[valueKey] = value;
        setParts.push(`${nameKey} = ${valueKey}`);
    }

    if(setParts.length === 0) return null;

    i += 1; // Increment for UpdatedAt
    const updateCommand = `#key${i}`;
    const updateValue = `:value${i}`;
    exprNames[updateCommand] = "UpdatedAt";
    exprValues[updateValue] = new Date().toISOString();
    setParts.push(`${updateCommand} = ${updateValue}`);

    const updateExpr = "SET " + setParts.join(", ");

    const res = await ddb.send(new UpdateCommand({
        TableName: USERS_TABLE,
        Key: {UserId: userId},
        UpdateExpression: updateExpr, // Corrected variable name
        ExpressionAttributeNames: exprNames,
        ExpressionAttributeValues: exprValues,
        ReturnValues: "ALL_NEW",
    }));

   return res.Attributes || null;
}

export async function deleteUser(userId) {
  await ddb.send(new DeleteCommand({
    TableName: USERS_TABLE,
    Key: { UserId: userId },
    ConditionExpression: "attribute_exists(UserId)",
  }));
  return { deleted: true };
}

