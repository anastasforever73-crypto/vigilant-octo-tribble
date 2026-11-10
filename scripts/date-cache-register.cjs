/* eslint-disable @typescript-eslint/no-require-imports */
const fs=require('node:fs'),Module=require('node:module'),ts=require('typescript');
require('@next/env').loadEnvConfig(process.cwd(),false,{info(){},error(){}});
const load=Module._load;
Module._load=function(n,p,m){if(n==='server-only')return {};if(n.startsWith('@/'))n=process.cwd()+'/'+n.slice(2);return load.call(this,n,p,m)};
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
