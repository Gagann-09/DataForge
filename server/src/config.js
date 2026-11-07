import dotenv from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const serverDirectory = resolve(currentDirectory, '..');

dotenv.config({
  path: resolve(serverDirectory, '.env')
});

const rawPort = process.env.PORT ?? '4000';
const port = Number(rawPort);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`Invalid PORT configuration: ${rawPort}`);
}

const mongodbUri =
  process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';

const dbName = process.env.DB_NAME || 'dataforge';
const collectionName = process.env.COLLECTION_NAME || 'events';

if (!mongodbUri.trim()) {
  throw new Error('MONGODB_URI must not be empty');
}

if (!dbName.trim()) {
  throw new Error('DB_NAME must not be empty');
}

if (!collectionName.trim()) {
  throw new Error('COLLECTION_NAME must not be empty');
}

export const config = Object.freeze({
  port,
  mongodbUri,
  dbName,
  collectionName,
  jsonLimit: '5mb',
  maxPoolSize: 20,
  serverSelectionTimeoutMS: 5000
});

export default config;
