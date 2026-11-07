import { MongoClient } from 'mongodb';
import config from './config.js';

let client = null;
let database = null;
let connectionPromise = null;

export async function connectToDatabase() {
  if (database) {
    return database;
  }

  if (connectionPromise) {
    return connectionPromise;
  }

  connectionPromise = (async () => {
    const nextClient = new MongoClient(config.mongodbUri, {
      maxPoolSize: config.maxPoolSize,
      serverSelectionTimeoutMS: config.serverSelectionTimeoutMS
    });

    try {
      await nextClient.connect();

      const nextDatabase = nextClient.db(config.dbName);
      await nextDatabase.command({ ping: 1 });

      client = nextClient;
      database = nextDatabase;

      return database;
    } catch (error) {
      await nextClient.close().catch(() => {});
      throw error;
    } finally {
      connectionPromise = null;
    }
  })();

  return connectionPromise;
}

export function getDatabase() {
  if (!database) {
    throw new Error('MongoDB is not connected');
  }

  return database;
}

export function getCollection() {
  return getDatabase().collection(config.collectionName);
}

export async function closeDatabase() {
  if (connectionPromise) {
    try {
      await connectionPromise;
    } catch {
      // Connection failure is handled by the startup caller.
    }
  }

  if (client) {
    const activeClient = client;

    client = null;
    database = null;

    await activeClient.close();
  }
}
