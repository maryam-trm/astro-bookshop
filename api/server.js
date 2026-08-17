const express = require("express");
const { Pool } = require("pg");
const fs = require("fs");

const app = express();
const PORT = 3000;

// Read database password from Docker secret
const dbPassword = fs
  .readFileSync("/run/secrets/db_password", "utf8")
  .trim();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.POSTGRES_USER,
  password: dbPassword,
  database: process.env.POSTGRES_DB,
});

app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    message: "Bookshop API is running",
  });
});

// Get all books
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
        cover,
        is_customizable,
        active
      FROM books
      WHERE active = TRUE
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

// Create a book
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

// Calculate cart price securely on the server
app.post("/cart/quote", async (req, res) => {
  const { items } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({
      error: "Cart must contain at least one item",
    });
  }

  try {
    const quotedItems = [];
    let subtotal = 0;

    for (const item of items) {
      const quantity = Number(item.quantity || 1);

      if (quantity < 1) {
        return res.status(400).json({
          error: "Quantity must be at least 1",
        });
      }

      const bookResult = await pool.query(
        `
        SELECT id, slug, title, price
        FROM books
        WHERE id = $1
          AND active = TRUE
        `,
        [item.book_id]
      );

      if (bookResult.rows.length === 0) {
        return res.status(404).json({
          error: `Book ${item.book_id} not found`,
        });
      }

      const book = bookResult.rows[0];

      const coverType = item.cover_type || "softcover";

      const coverResult = await pool.query(
        `
        SELECT price_delta
        FROM book_options
        WHERE book_id = $1
          AND option_type = 'cover'
          AND option_value = $2
        `,
        [item.book_id, coverType]
      );

      if (coverResult.rows.length === 0) {
        return res.status(400).json({
          error: `Invalid cover option: ${coverType}`,
        });
      }

      const basePrice = Number(book.price);
      const coverPrice = Number(coverResult.rows[0].price_delta);

      let giftWrapPrice = 0;

      if (item.gift_wrap === true) {
        const giftResult = await pool.query(
          `
          SELECT price_delta
          FROM book_options
          WHERE book_id = $1
            AND option_type = 'gift_wrap'
            AND option_value = 'yes'
          `,
          [item.book_id]
        );

        if (giftResult.rows.length > 0) {
          giftWrapPrice = Number(giftResult.rows[0].price_delta);
        }
      }

      const customizationPrice = coverPrice + giftWrapPrice;
      const unitPrice = basePrice + customizationPrice;
      const lineTotal = unitPrice * quantity;

      subtotal += lineTotal;

      quotedItems.push({
        book_id: book.id,
        slug: book.slug,
        title: book.title,
        quantity,
        cover_type: coverType,
        gift_wrap: item.gift_wrap === true,
        child_name_arabic: item.child_name_arabic || null,
        child_name_secondary: item.child_name_secondary || null,
        secondary_language: item.secondary_language || null,
        child_gender: item.child_gender || null,
        base_price: basePrice,
        customization_price: customizationPrice,
        unit_price: unitPrice,
        line_total: lineTotal,
      });
    }

    res.json({
      items: quotedItems,
      subtotal,
      currency: "USD",
    });
  } catch (error) {
    console.error("POST /cart/quote error:", error);

    res.status(500).json({
      error: "Failed to calculate cart",
    });
  }
});

app.post("/orders", async (req, res) => {
  const {
    customer_email,
    customer_name,
    phone,
    shipping_address,
    shipping_country,
    shipping_method,
    items,
  } = req.body;

  if (
    !customer_email ||
    !customer_name ||
    !shipping_address ||
    !shipping_country
  ) {
    return res.status(400).json({
      error: "Missing customer or shipping information",
    });
  }

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({
      error: "Order must contain at least one item",
    });
  }

  const shippingPrices = {
    standard: 5,
    express: 12,
  };

  const shippingCost =
    shippingPrices[shipping_method] ?? null;

  if (shippingCost === null) {
    return res.status(400).json({
      error: "Invalid shipping method",
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const pricedItems = [];
    let subtotal = 0;

    for (const item of items) {
      const quantity = Number(item.quantity || 1);

      if (quantity < 1) {
        throw new Error("Invalid quantity");
      }

      const bookResult = await client.query(
        `
        SELECT id, title, price
        FROM books
        WHERE id = $1
          AND active = TRUE
        `,
        [item.book_id]
      );

      if (bookResult.rows.length === 0) {
        throw new Error(
          `Book ${item.book_id} not found`
        );
      }

      const book = bookResult.rows[0];
      const basePrice = Number(book.price);

      const coverType =
        item.cover_type || "softcover";

      const coverResult = await client.query(
        `
        SELECT price_delta
        FROM book_options
        WHERE book_id = $1
          AND option_type = 'cover'
          AND option_value = $2
        `,
        [item.book_id, coverType]
      );

      if (coverResult.rows.length === 0) {
        throw new Error("Invalid cover option");
      }

      const coverPrice = Number(
        coverResult.rows[0].price_delta
      );

      let giftWrapPrice = 0;

      if (item.gift_wrap === true) {
        const giftResult = await client.query(
          `
          SELECT price_delta
          FROM book_options
          WHERE book_id = $1
            AND option_type = 'gift_wrap'
            AND option_value = 'yes'
          `,
          [item.book_id]
        );

        if (giftResult.rows.length > 0) {
          giftWrapPrice = Number(
            giftResult.rows[0].price_delta
          );
        }
      }

      const customizationPrice =
        coverPrice + giftWrapPrice;

      const unitPrice =
        basePrice + customizationPrice;

      const lineTotal =
        unitPrice * quantity;

      subtotal += lineTotal;

      pricedItems.push({
        ...item,
        quantity,
        base_price: basePrice,
        customization_price: customizationPrice,
        unit_price: unitPrice,
        line_total: lineTotal,
      });
    }

    const totalAmount =
      subtotal + shippingCost;

    const orderResult = await client.query(
      `
      INSERT INTO orders
      (
        customer_email,
        customer_name,
        phone,
        shipping_address,
        shipping_country,
        shipping_method,
        subtotal,
        shipping_cost,
        discount_amount,
        total_amount,
        currency,
        payment_status,
        order_status
      )
      VALUES
      (
        $1,$2,$3,$4,$5,$6,
        $7,$8,0,$9,
        'USD','pending','pending'
      )
      RETURNING *
      `,
      [
        customer_email,
        customer_name,
        phone,
        shipping_address,
        shipping_country,
        shipping_method,
        subtotal,
        shippingCost,
        totalAmount,
      ]
    );

    const order = orderResult.rows[0];

    for (const item of pricedItems) {
      await client.query(
        `
        INSERT INTO order_items
        (
          order_id,
          book_id,
          quantity,
          child_name_arabic,
          child_name_secondary,
          secondary_language,
          child_gender,
          cover_type,
          gift_wrap,
          base_price,
          customization_price,
          unit_price,
          line_total
        )
        VALUES
        (
          $1,$2,$3,$4,$5,$6,$7,
          $8,$9,$10,$11,$12,$13
        )
        `,
        [
          order.id,
          item.book_id,
          item.quantity,
          item.child_name_arabic || null,
          item.child_name_secondary || null,
          item.secondary_language || null,
          item.child_gender || null,
          item.cover_type,
          item.gift_wrap === true,
          item.base_price,
          item.customization_price,
          item.unit_price,
          item.line_total,
        ]
      );
    }

    await client.query("COMMIT");

    res.status(201).json({
      order_id: order.id,
      payment_status: order.payment_status,
      order_status: order.order_status,
      subtotal: Number(order.subtotal),
      shipping_cost: Number(order.shipping_cost),
      total: Number(order.total_amount),
      currency: order.currency,
    });
  } catch (error) {
    await client.query("ROLLBACK");

    console.error("POST /orders error:", error);

    res.status(500).json({
      error: "Failed to create order",
    });
  } finally {
    client.release();
  }
});

app.post("/orders/:id/pay", async (req, res) => {
  const orderId = Number(req.params.id);

  if (!Number.isInteger(orderId)) {
    return res.status(400).json({
      error: "Invalid order ID",
    });
  }

  try {
    const result = await pool.query(
      `
      UPDATE orders
      SET
        payment_status = 'paid',
        order_status = 'processing',
        payment_provider = 'mock',
        payment_reference = $2
      WHERE id = $1
        AND payment_status = 'pending'
      RETURNING *
      `,
      [
        orderId,
        `mock_${Date.now()}`,
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Pending order not found",
      });
    }

    const order = result.rows[0];

    res.json({
      order_id: order.id,
      payment_status: order.payment_status,
      order_status: order.order_status,
      total: Number(order.total_amount),
      currency: order.currency,
      payment_reference:
        order.payment_reference,
    });
  } catch (error) {
    console.error("POST /orders/:id/pay error:", error);

    res.status(500).json({
      error: "Payment failed",
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Bookshop API running on port ${PORT}`);
});