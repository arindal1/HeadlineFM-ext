const mongoose = require('mongoose');

/**
 * Narration cache document.
 *
 * Keyed on (date + categoriesKey). TTL index auto-deletes documents
 * after 48 hours so the collection never grows unbounded.
 *
 * size: narration text is ~3-4 KB → 1000 documents ≈ 3-4 MB (well within Atlas M0).
 */
const narrationSchema = new mongoose.Schema(
  {
    // "YYYY-MM-DD"  (UTC)
    date: {
      type:     String,
      required: true,
      match:    /^\d{4}-\d{2}-\d{2}$/,
    },
    // Sorted, comma-joined category IDs, e.g. "business,science,technology"
    categoriesKey: {
      type:     String,
      required: true,
      trim:     true,
    },
    // The Gemini-generated narration script
    narration: {
      type:     String,
      required: true,
    },
    // Soft metadata — not used for logic, useful for debugging
    categoryCount: {
      type: Number,
    },
  },
  {
    timestamps: true, // adds createdAt + updatedAt
  }
);

// Compound unique index — one cache entry per (date, category combination)
narrationSchema.index({ date: 1, categoriesKey: 1 }, { unique: true });

// TTL index: auto-delete documents older than 48 h
// (keeps Atlas M0 clean; 1 extra day grace period in case of timezone differences)
narrationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 172_800 }); // 48 h

module.exports = mongoose.model('Narration', narrationSchema);
