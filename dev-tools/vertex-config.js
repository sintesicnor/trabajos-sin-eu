const { VertexAI } = require('@google-cloud/vertexai');
require('dotenv').config();

const vertexAI = new VertexAI({
  project: process.env.GOOGLE_CLOUD_PROJECT,
  location: process.env.GOOGLE_CLOUD_LOCATION,
});

const generativeModel = vertexAI.getGenerativeModel({
  model: 'gemini-1.5-pro-002',
});

module.exports = { generativeModel };