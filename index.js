// POST   /users
// GET    /users/me
// PUT    /users/me

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

import admin from "firebase-admin";

const USERS_TABLE = process.env.USERS_TABLE; 
const FIREBASE_PROJECT_ID = "aerosaur-2nd-sem"; 

const FIREBASE_SERVICE_ACCOUNT_JSON = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

if (!USERS_TABLE) throw new Error("Missing env USERS_TABLE");
if (!FIREBASE_PROJECT_ID) throw new Error("Missing env FIREBASE_PROJECT_ID");
if (!FIREBASE_SERVICE_ACCOUNT_JSON) {
  throw new Error(
    "Missing env FIREBASE_SERVICE_ACCOUNT_JSON"
  );
}

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

function initFirebaseAdmin() {
  if (admin.apps.length) return;

  const serviceAccount = JSON.parse(FIREBASE_SERVICE_ACCOUNT_JSON);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: FIREBASE_PROJECT_ID,
  });
}

function jsonResponse(statusCode, bodyObj) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    },
    body: JSON.stringify(bodyObj),
  };
}

function getAuthToken(event) {
  const header =
    event?.headers?.authorization || event?.headers?.Authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

async function verifyFirebaseToken(idToken) {
  initFirebaseAdmin();

  const decoded = await admin.auth().verifyIdToken(idToken);

  return decoded;
}

function parseBody(event) {
  if (!event.body) return {};
  try {
    return JSON.parse(event.body);
  } catch {
    return null;
  }
}

function getRoute(event) {
  const method = event?.requestContext?.http?.method || "";
  const path = event?.rawPath || "";
  return { method, path };
}

//create / signin
async function handleCreateUserProfile(decodedToken, body) {
  const uid = decodedToken.uid;
  const email = decodedToken.email || null;

  const username = (body?.username || "").trim();

  if (!username) {
    return jsonResponse(400, { message: "username is required" });
  }

  const provider = decodedToken?.firebase?.sign_in_provider || null;
  const googleEmail = provider === "google.com" ? email : null;

  const existing = await ddb.send(
    new GetCommand({
      TableName: USERS_TABLE,
      Key: { UserId: uid },
    })
  );

  if (existing.Item) {
    return jsonResponse(200, {
      message: "Profile already exists",
      profile: existing.Item,
    });
  }

  const now = new Date().toISOString();

  const item = {
    UserId: uid,
    Email: email,
    Username: username,
    GoogleEmail: googleEmail,
    CreatedAt: now,
    UpdatedAt: now,
  };

  await ddb.send(
    new PutCommand({
      TableName: USERS_TABLE,
      Item: item,
      ConditionExpression: "attribute_not_exists(UserId)",
    })
  );

  return jsonResponse(201, { message: "Profile created", profile: item });
}

//gettter
async function handleGetMe(decodedToken) {
  const uid = decodedToken.uid;

  const result = await ddb.send(
    new GetCommand({
      TableName: USERS_TABLE,
      Key: { UserId: uid },
    })
  );

  if (!result.Item) {
    return jsonResponse(404, { message: "Profile not found" });
  }

  return jsonResponse(200, { profile: result.Item });
}

//update profile
async function handleUpdateMe(decodedToken, body) {
  const uid = decodedToken.uid;

  const username = body?.username?.trim();

  if (!username) {
    return jsonResponse(400, { message: "username is required" });
  }

  const now = new Date().toISOString();

  const result = await ddb.send(
    new UpdateCommand({
      TableName: USERS_TABLE,
      Key: { UserId: uid },
      UpdateExpression: "SET #U = :u, UpdatedAt = :now",
      ExpressionAttributeNames: { "#U": "Username" },
      ExpressionAttributeValues: { ":u": username, ":now": now },
      ConditionExpression: "attribute_exists(UserId)", // must exist
      ReturnValues: "ALL_NEW",
    })
  );

  return jsonResponse(200, { message: "Profile updated", profile: result.Attributes });
}

export const handler = async (event) => {
  try {
    if ((event?.requestContext?.http?.method || "") === "OPTIONS") {
      return jsonResponse(200, { ok: true });
    }

    const { method, path } = getRoute(event);

    const token = getAuthToken(event);
    if (!token) return jsonResponse(401, { message: "Missing Authorization Bearer token" });

    let decoded;
    try {
      decoded = await verifyFirebaseToken(token);
    } catch (e) {
      return jsonResponse(401, { message: "Invalid or expired Firebase token" });
    }

    const body = parseBody(event);
    if (body === null) return jsonResponse(400, { message: "Invalid JSON body" });

    if (method === "POST" && path === "/users") {
      return await handleCreateUserProfile(decoded, body);
    }

    if (method === "GET" && path === "/users/me") {
      return await handleGetMe(decoded);
    }

    if (method === "PUT" && path === "/users/me") {
      return await handleUpdateMe(decoded, body);
    }

    return jsonResponse(404, { message: "Route not found", route: { method, path } });
  } catch (err) {
    console.error("Unhandled error:", err);
    return jsonResponse(500, { message: "Internal server error" });
  }
};


