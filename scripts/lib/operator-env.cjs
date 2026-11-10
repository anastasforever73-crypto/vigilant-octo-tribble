const fs = require('node:fs');
function operatorEnv() {
  if (process.env.MIGRATION_ENV_FILE) {
    const values = JSON.parse(fs.readFileSync(process.env.MIGRATION_ENV_FILE,'utf8'));
    for (const [key,value] of Object.entries(values)) process.env[key] = typeof value === 'string' ? value : JSON.stringify(value);
  } else require('@next/env').loadEnvConfig(process.cwd(),false,{info(){},error(){}});
}
module.exports = { operatorEnv };
