const axios = require('axios');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

const CONFIG = {
  baseUrl: 'https://jsonplaceholder.typicode.com',
  maxRetries: 3,
  retryDelay: 1000,
  postsPerUser: 5,
  commentsPerPost: 3,
  outputFile: 'output.csv'
};

class Logger {
  static info(message) {
    console.log(`[INFO] ${new Date().toISOString()} - ${message}`);
  }
  static error(message, error = null) {
    console.error(`[ERROR] ${new Date().toISOString()} - ${message}`);
    if (error) {
      console.error(`[ERROR] Details:`, error.message);
    }
  }
  static warn(message) {
    console.warn(`[WARN] ${new Date().toISOString()} - ${message}`);
  }
}

class HttpClient {
  constructor() {
    this.axiosInstance = axios.create({
      timeout: 10000,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  async request(url, retries = 0) {
    try {
      Logger.info(`Making request to: ${url}`);
      const response = await this.axiosInstance.get(url);
      Logger.info(`Request successful: ${url}`);
      return response.data;
    } catch (error) {
      if (retries < CONFIG.maxRetries) {
        const delay = CONFIG.retryDelay * Math.pow(2, retries);
        Logger.warn(`Request failed, retrying in ${delay}ms (attempt ${retries + 1}/${CONFIG.maxRetries}): ${url}`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.request(url, retries + 1);
      } else {
        Logger.error(`Request failed after ${CONFIG.maxRetries} retries: ${url}`, error);
        throw error;
      }
    }
  }
}

class DataValidator {
  static validateUser(user) {
    const required = ['id', 'name'];
    const missing = required.filter(field => !user[field]);
    if (missing.length > 0) {
      Logger.error(`Invalid user data - missing fields: ${missing.join(', ')}`, { userId: user.id });
      return false;
    }
    return true;
  }
  static validatePost(post) {
    const required = ['id', 'title'];
    const missing = required.filter(field => !post[field]);
    if (missing.length > 0) {
      Logger.error(`Invalid post data - missing fields: ${missing.join(', ')}`, { postId: post.id });
      return false;
    }
    return true;
  }
  static validateComment(comment) {
    const required = ['id', 'body', 'email'];
    const missing = required.filter(field => !comment[field]);
    if (missing.length > 0) {
      Logger.error(`Invalid comment data - missing fields: ${missing.join(', ')}`, { commentId: comment.id });
      return false;
    }
    return true;
  }
}

class ApiService {
  constructor() {
    this.httpClient = new HttpClient();
  }
  async getUsers() {
    Logger.info('Fetching users...');
    const users = await this.httpClient.request(`${CONFIG.baseUrl}/users`);
    Logger.info(`Fetched ${users.length} users`);
    return users;
  }
  async getPostsByUserId(userId) {
    Logger.info(`Fetching posts for user ${userId}...`);
    const posts = await this.httpClient.request(`${CONFIG.baseUrl}/posts?userId=${userId}`);
    const sortedPosts = posts.sort((a, b) => {
      if (a.date && b.date) {
        return new Date(b.date) - new Date(a.date);
      }
      return b.id - a.id;
    });
    return sortedPosts.slice(0, CONFIG.postsPerUser);
  }
  async getCommentsByPostId(postId) {
    Logger.info(`Fetching comments for post ${postId}...`);
    const comments = await this.httpClient.request(`${CONFIG.baseUrl}/comments?postId=${postId}`);
    const sortedComments = comments.sort((a, b) => {
      if (a.date && b.date) {
        return new Date(b.date) - new Date(a.date);
      }
      return b.id - a.id;
    });
    return sortedComments.slice(0, CONFIG.commentsPerPost);
  }
}

class CsvWriter {
  constructor() {
    this.csvWriter = createCsvWriter({
      path: CONFIG.outputFile,
      header: [
        { id: 'userId', title: 'userId' },
        { id: 'userName', title: 'userName' },
        { id: 'postId', title: 'postId' },
        { id: 'postTitle', title: 'postTitle' },
        { id: 'commentId', title: 'commentId' },
        { id: 'commentBody', title: 'commentBody' },
        { id: 'commentEmail', title: 'commentEmail' }
      ]
    });
  }
  async writeRecords(records) {
    try {
      await this.csvWriter.writeRecords(records);
      Logger.info(`Successfully wrote ${records.length} records to ${CONFIG.outputFile}`);
    } catch (error) {
      Logger.error('Failed to write CSV file', error);
      throw error;
    }
  }
}

class DataProcessor {
  constructor() {
    this.apiService = new ApiService();
    this.csvWriter = new CsvWriter();
  }
  async process() {
    try {
      Logger.info('Starting data processing...');
      const users = await this.apiService.getUsers();
      const evenUsers = users.filter(user => user.id % 2 === 0);
      Logger.info(`Filtered ${evenUsers.length} users with even IDs`);
      const allRecords = [];
      for (const user of evenUsers) {
        if (!DataValidator.validateUser(user)) continue;
        try {
          const posts = await this.apiService.getPostsByUserId(user.id);
          const postsWithComments = await Promise.all(
            posts.map(async (post) => {
              if (!DataValidator.validatePost(post)) return { post, comments: [] };
              try {
                const comments = await this.apiService.getCommentsByPostId(post.id);
                return { post, comments };
              } catch (error) {
                Logger.error(`Failed to fetch comments for post ${post.id}`, error);
                return { post, comments: [] };
              }
            })
          );
          postsWithComments.forEach(({ post, comments }) => {
            comments.forEach(comment => {
              if (DataValidator.validateComment(comment)) {
                allRecords.push({
                  userId: user.id,
                  userName: user.name,
                  postId: post.id,
                  postTitle: post.title,
                  commentId: comment.id,
                  commentBody: comment.body,
                  commentEmail: comment.email
                });
              }
            });
          });
        } catch (error) {
          Logger.error(`Failed to process user ${user.id}`, error);
        }
      }
      if (allRecords.length > 0) {
        await this.csvWriter.writeRecords(allRecords);
        Logger.info(`Processing completed. Total records: ${allRecords.length}`);
      } else {
        Logger.warn('No valid records to write to CSV');
      }
    } catch (error) {
      Logger.error('Data processing failed', error);
      throw error;
    }
  }
}

async function main() {
  try {
    Logger.info('Starting application...');
    const processor = new DataProcessor();
    await processor.process();
    Logger.info('Application completed successfully');
  } catch (error) {
    Logger.error('Application failed', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

// For future export/tests
/*module.exports = {
  DataProcessor,
  ApiService,
  HttpClient,
  DataValidator,
  CsvWriter,
  Logger
};
*/