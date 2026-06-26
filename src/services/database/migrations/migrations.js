// Migrations module - Versioned database schema and data migration registry
//
// This module provides a declarative, file-based migration system.
// Each version has its own directory containing schema.map and/or data.map files.
//
// Directory structure:
//   migrations/
//   ├── index.js              <- This file, the entry point
//   ├── _template.map         <- Template for creating new migrations
//   └── {version}/
//       ├── schema.map        <- Table structure changes (ALTER TABLE, CREATE INDEX)
//       └── data.map          <- Data fixes (DELETE, UPDATE operations)

export { runMigrations } from './index.js';
