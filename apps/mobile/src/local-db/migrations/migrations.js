// This file is required for Expo/React Native SQLite migrations - https://orm.drizzle.team/quick-sqlite/expo

import journal from './meta/_journal.json';
import m0000 from './0000_v1_schema.sql';
import m0001 from './0001_overjoyed_wild_pack.sql';
import m0002 from './0002_pretty_puppet_master.sql';
import m0003 from './0003_dirty_day_revision.sql';
import m0004 from './0004_own_food_search.sql';
import m0005 from './0005_sync_cursor_pulled_at.sql';

  export default {
    journal,
    migrations: {
      m0000,
m0001,
m0002,
m0003,
m0004,
m0005
    }
  }
  