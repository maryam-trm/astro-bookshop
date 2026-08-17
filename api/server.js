const express = require("express");
const { Pool } = require("pg");
const fs = require("fs");

const app = express();
const PORT = 3000;

// Read PostgreSQL password from Docker secret
const dbPassword = fs
  .readFileSync("/run/secrets/db_password", "utf8")
  .trim();

// PostgreSQL connection
const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.POSTGRES_USER,
  password: dbPassword,
  database: process.env.POSTGRES_DB,
});

// Allow JSON request bodies
app.use(express.json());

// API health/root route
app.get("/", (req, res) => {
  res.json({
    message: "Bookshop API is running",
  });
});

// Get all books from PostgreSQL
app.get("/books", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        slug,
        title,
        author,
        category,
        price,
        age,
        language,
        description,
        cover
      FROM books
      ORDER BY id
    `);

    res.json(result.rows);
  } catch (error) {
    console.error("GET /books error:", error);
    res.status(500).json({
      error: "Database query failed",
    });
  }
});

// Create a new book
app.post("/books", async (req, res) => {
  const {
    slug,
    title,
    author,
    category,
    price,
    age,
    language,
    description,
    cover,
  } = req.body;

  try {
    const result = await pool.query(
      `
      INSERT INTO books
      (
        slug,
        title,
        author,
        category,
        price,
        age,
        language,
        description,
        cover
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *
      `,
      [
        slug,
        title,
        author,
        category,
        price,
        age,
        language,
        description,
        cover,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("POST /books error:", error);

    res.status(500).json({
      error: "Failed to create book",
    });
  }
});

// Start API
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Bookshop API running on port ${PORT}`);
});