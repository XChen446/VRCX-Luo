import { adapter } from './adapter/index.js';

function transformKey(key) {
    return `config:${String(key).toLowerCase()}`;
}

class ConfigRepository {
    async init() {
        await adapter.createTable('configs', [
            { name: 'key', type: 'TEXT', constraints: 'PRIMARY KEY' },
            { name: 'value', type: 'TEXT' }
        ]);
    }

    async remove(key) {
        const _key = transformKey(key);
        await adapter.delete('configs', { key: _key });
    }

    async getString(key, defaultValue = null) {
        const _key = transformKey(key);
        const row = await adapter.selectOne('configs', ['value'], {
            key: _key
        });
        const value = row ? row[0] : undefined;
        if (value === null || value === undefined || value === 'undefined') {
            return defaultValue;
        }
        return value;
    }

    async setString(key, value) {
        const _key = transformKey(key);
        const _value = String(value);
        await adapter.insert(
            'configs',
            { key: _key, value: _value },
            'replace'
        );
    }

    async getBool(key, defaultValue = null) {
        const value = await this.getString(key, null);
        if (value === null || value === undefined) {
            return defaultValue;
        }
        return value === 'true';
    }

    async setBool(key, value) {
        await this.setString(key, value ? 'true' : 'false');
    }

    async getInt(key, defaultValue = null) {
        let value = await this.getString(key, null);
        if (value === null || value === undefined) {
            return defaultValue;
        }
        value = parseInt(value, 10);
        if (isNaN(value) === true) {
            return defaultValue;
        }
        return value;
    }

    async setInt(key, value) {
        await this.setString(key, value);
    }

    async getFloat(key, defaultValue = null) {
        let value = await this.getString(key, null);
        if (value === null || value === undefined) {
            return defaultValue;
        }
        value = parseFloat(value);
        if (isNaN(value) === true) {
            return defaultValue;
        }
        return value;
    }

    async setFloat(key, value) {
        await this.setString(key, value);
    }

    async getObject(key, defaultValue = null) {
        let value = await this.getString(key, null);
        if (value === null || value === undefined) {
            return defaultValue;
        }
        try {
            value = JSON.parse(value);
        } catch {
            // ignore JSON parse errors
        }
        if (value !== Object(value)) {
            return defaultValue;
        }
        return value;
    }

    async setObject(key, value) {
        await this.setString(key, JSON.stringify(value));
    }

    async getArray(key, defaultValue = null) {
        const value = await this.getObject(key, null);
        if (Array.isArray(value) === false) {
            return defaultValue;
        }
        return value;
    }

    async setArray(key, value) {
        await this.setObject(key, value);
    }
}

var self = new ConfigRepository();

export { self as default, ConfigRepository, transformKey };
