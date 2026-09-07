import { describe,it,expect } from 'vitest';
import { readFileSync,readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
function files(dir:string):string[]{return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):/\.tsx?$/.test(e.name)?[path.join(dir,e.name)]:[]);}
describe('AI account attribution',()=>{
 it('requires spending context at every feature generateText call site',()=>{
   const missing:string[]=[];
   for(const file of [...files('lib'),...files('app')]){
     if(file==='lib/ai.ts')continue;
     const source=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
     const visit=(node:ts.Node)=>{
       if(ts.isCallExpression(node)&&node.expression.getText(source)==='generateText'){
         const arg=node.arguments[0];
         if(!arg||!ts.isObjectLiteralExpression(arg)||!arg.properties.some(p=>ts.isPropertyAssignment(p)&&p.name.getText(source)==='spendContext'))missing.push(file);
       }
       ts.forEachChild(node,visit);
     };visit(source);
   }
   expect(missing).toEqual([]);
 });
});
