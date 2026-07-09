require('dotenv').config();

const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
const url = "https://generativelanguage.googleapis.com/v1/models?key=" + key;

fetch(url)
  .then(res => res.json())
  .then(data => {
    if (data.error) {
      console.log("Error:", data.error.message);
    } else {
      console.log("--- MODELOS ---");
      data.models.forEach(m => console.log(m.name));
    }
  })
  .catch(err => console.log("Error:", err.message));