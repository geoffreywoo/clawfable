import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { calibrateQualityCutoffs, type QualityCalibrationExample } from '../lib/quality-calibration';
async function main(){
 const filename=process.argv[2];if(!filename)throw new Error('Supply a private JSON file of verified owner-labelled, scored calibration examples.');
 const examples=JSON.parse(await readFile(filename,'utf8')) as QualityCalibrationExample[];
 const report=calibrateQualityCutoffs(examples); const evidenceHash=createHash('sha256').update(JSON.stringify(examples)).digest('hex');
 await mkdir('.gstack/quality-calibration',{recursive:true,mode:0o700});
 await writeFile('.gstack/quality-calibration/result.json',JSON.stringify({...report,evidenceHash},null,2),{mode:0o600});
 if(process.argv.includes('--activate')){
   if(!report.activated)throw new Error(`Cannot activate: ${report.reason}`);
   await writeFile('lib/geoffrey-quality-calibration.json',JSON.stringify({version:report.version,activated:true,evidenceHash,cutoffs:report.cutoffs},null,2)+'\n');
 }
 console.log(JSON.stringify({activated:report.activated,reason:report.reason,counts:report.counts,cutoffs:report.cutoffs}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
