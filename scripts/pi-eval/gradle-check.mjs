// Model-free, tiny JVM fixture. Never launches PhotoQuest's full suite.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { createGradleGuard, removeGradleGuard, runProcess, sandboxProfile, hash } from './safety.mjs';
import { check, stopGradle } from '../pi-eval.mjs';

export async function gradleRuntimeCheck(area) {
  const home = homedir();
  const dist = path.join(home, '.gradle/wrapper/dists');
  const gradle = readdirSync(dist, { recursive: true }).map(String).find(p => p.includes('gradle-9.2.1/bin/gradle'));
  assert.ok(gradle, 'cached Gradle 9.2.1 required');
  const ws = path.join(area, 'gradle-owned'); mkdirSync(ws);
  const unrelated = path.join(area, 'gradle-unrelated'); mkdirSync(unrelated);
  const g = createGradleGuard(ws);
  const maxForks = path.join(home, '.gradle/init.d/pi-eval-max-forks.gradle');
  const forksHash = existsSync(maxForks) ? hash(readFileSync(maxForks)) : null;
  const caches = path.join(home, '.gradle/caches');
  const cacheStat = existsSync(caches);
  const jars = [
    ['org.junit.jupiter','junit-jupiter-api','5.12.2'], ['org.junit.jupiter','junit-jupiter-engine','5.12.2'],
    ['org.junit.platform','junit-platform-commons','1.12.2'], ['org.junit.platform','junit-platform-engine','1.12.2'],
    ['org.junit.platform','junit-platform-launcher','1.12.2'], ['org.opentest4j','opentest4j','1.3.0'], ['org.apiguardian','apiguardian-api','1.1.2'],
  ].map(([group, artifact, version]) => {
    const d = path.join(caches,'modules-2/files-2.1',group,artifact,version);
    return path.join(d, readdirSync(d, { recursive:true }).map(String).find(p=>p.endsWith('.jar')));
  });
  const build = `plugins { id 'java' }
repositories { mavenCentral() }
dependencies { testImplementation files(${jars.map(JSON.stringify).join(',')}) }
tasks.withType(Test).configureEach { useJUnitPlatform(); maxParallelForks = 2 }
tasks.register('otherTest', Test) { testClassesDirs = sourceSets.test.output.classesDirs; classpath = sourceSets.test.runtimeClasspath }
tasks.register('optOutTest', Test) { useJUnitPlatform { excludeTags('e2e') } }
tasks.register('allTests') { dependsOn test }
tasks.register('focusedTest', Test) { testClassesDirs = sourceSets.test.output.classesDirs; classpath = sourceSets.test.runtimeClasspath; filter { includeTestsMatching 'de.tschuehly.photoquest.web.Eval*Test' } }
tasks.register('focused') { dependsOn focusedTest }
tasks.register('pitest') { doLast { throw new GradleException('MUTATION EXECUTED') } }
`;
  for(const dir of [ws,unrelated]) {
    writeFileSync(path.join(dir,'settings.gradle'),"rootProject.name='guard-fixture'\n");
    writeFileSync(path.join(dir,'build.gradle'), build);
    writeFileSync(path.join(dir,'gradlew'),`#!/bin/bash\nexec ${JSON.stringify(path.join(dist,gradle))} "$@"\n`,{mode:0o700});
    const src=path.join(dir,'src/test/java/de/tschuehly/photoquest/web'); mkdirSync(src,{recursive:true});
    for(const name of ['EvalOutcomeTest','BotBlockerFilterTest','DownloadModalComponentTest','CacheServiceTest']) writeFileSync(path.join(src,`${name}.java`),`package de.tschuehly.photoquest.web; public class ${name} { @org.junit.jupiter.api.Test void works() { org.junit.jupiter.api.Assertions.assertTrue(true); } @org.junit.jupiter.api.Test @org.junit.jupiter.api.Tag("e2e") void excluded() { throw new AssertionError("e2e ran"); } }`);
  }
  const e2e=path.join(ws,'src/test/java/de/tschuehly/photoquest/e2e'); mkdirSync(e2e,{recursive:true});
  writeFileSync(path.join(e2e,'TrustedE2ETest.java'),'package de.tschuehly.photoquest.e2e; @org.junit.jupiter.api.Tag("e2e") public class TrustedE2ETest { @org.junit.jupiter.api.Test void focusedControl() {} }');
  writeFileSync(path.join(ws,'indirect.sh'), '#!/bin/bash\n./gradlew --max-workers=1 check\n');
  writeFileSync(path.join(ws,'Taskfile.yml'), 'version: "3"\ntasks:\n  spring:test:\n    cmds:\n      - ./gradlew --max-workers=1 test -Pplaywright.headless=true --build-cache --stacktrace\n');
  const java = process.env.JAVA_HOME ?? (await runProcess('/usr/libexec/java_home', ['-v', '21'])).stdout.trim();
  assert.ok(java, 'Java 21 required');
  const env = {...process.env,...g.env,JAVA_HOME:process.env.JAVA_HOME ?? java, PI_EVAL_MAX_FORKS:'2',GRADLE_OPTS:`${process.env.GRADLE_OPTS ?? ''} -Dorg.gradle.daemon.registry.base=${path.join(area,'gradle-check')}`};
  const invoke = async (command, {cwd=ws,token=true}={}) => {
    const r=await runProcess('sandbox-exec',['-p',sandboxProfile(area),'bash','-c',command],{cwd,env:{...env,PI_EVAL_ROUND_TOKEN:token?g.token:''},timeoutMs:90000});
    if(process.env.PI_EVAL_TEST_EVIDENCE) {
      mkdirSync(process.env.PI_EVAL_TEST_EVIDENCE,{recursive:true});
      writeFileSync(path.join(process.env.PI_EVAL_TEST_EVIDENCE,`gradle-${Date.now()}.log`),JSON.stringify({command,cwd,status:r.status})+'\n'+r.stdout+r.stderr);
    }
    return r;
  };
  const base = './gradlew --max-workers=1 --offline --daemon --console=plain --configuration-cache';
  try {
    const version=await invoke('./gradlew --max-workers=1 --version');
    assert.equal(version.status,0,version.stderr); assert.match(version.stdout,/Gradle 9\.2\.1/);
    // Trusted current checks keep their package selector AND e2e semantics, even with an ambient token.
    const caseDir=path.join(area,'trusted-e2e'); mkdirSync(caseDir);
    writeFileSync(path.join(caseDir,'check.sh'),`${base} test --tests 'de.tschuehly.photoquest.e2e.*' --rerun-tasks\n`);
    const previous=process.env.PI_EVAL_ROUND_TOKEN; process.env.PI_EVAL_ROUND_TOKEN=g.token;
    try {
      const trusted=await check({dir:caseDir,check:{type:'script',script:'check.sh'}},ws,'',area);
      assert.equal(trusted.pass,true,readFileSync(path.join(area,'check.log'),'utf8'));
      const xml=readFileSync(path.join(ws,'build/test-results/test/TEST-de.tschuehly.photoquest.e2e.TrustedE2ETest.xml'),'utf8');
      assert.match(xml,/name="focusedControl/);
      if(process.env.PI_EVAL_TEST_EVIDENCE) writeFileSync(path.join(process.env.PI_EVAL_TEST_EVIDENCE,'trusted-focused-e2e.log'),readFileSync(path.join(area,'check.log')));
    } finally { if(previous===undefined) delete process.env.PI_EVAL_ROUND_TOKEN; else process.env.PI_EVAL_ROUND_TOKEN=previous; }
    // No token => inert. Token but canonical unrelated path => inert. No e2e exclusion here.
    let r=await invoke(`${base} optOutTest`,{token:false}); assert.equal(r.status,0,r.stdout+r.stderr);
    r=await invoke(`${base} optOutTest`,{cwd:unrelated}); assert.equal(r.status,0,r.stdout+r.stderr);
    for(const command of [
      'test', 'check', 'build', ':test --tests "*"', 'test --tests "de.tschuehly.photoquest.*"',
      'test --tests "*Test*"', 'test --tests "*Test"', 'test --tests "de.tschuehly.photoquest.web.Eval*Test" otherTest',
      'allTests', 'pitest',
    ]) { r=await invoke(`${base} ${command}`); assert.notEqual(r.status,0,command); assert.match(r.stdout+r.stderr,/pi-eval:/,command+'\n'+r.stdout+r.stderr); }
    for(const command of ['bash indirect.sh','task spring:test']) { r=await invoke(command); assert.notEqual(r.status,0,command); assert.match(r.stdout+r.stderr,/pi-eval:/,r.stdout+r.stderr); }
    r=await invoke(`${base} focused`); assert.equal(r.status,0,r.stdout+r.stderr);
    // Exact retained multipart and impl-zip selectors, not merely equivalent argument assertions.
    for(const filter of ['de.tschuehly.photoquest.web.Eval*Test','de.tschuehly.photoquest.web.BotBlockerFilterTest','*DownloadModalComponentTest','*CacheServiceTest','de.tschuehly.photoquest.web.BotBlockerFilterTest.works']) {
      const command=`${base} test --tests '${filter}' --rerun-tasks`;
      r=await invoke(command); assert.equal(r.status,0,r.stdout+r.stderr);
      const xml=readdirSync(path.join(ws,'build/test-results/test')).filter(f=>f.endsWith('.xml')).map(f=>readFileSync(path.join(ws,'build/test-results/test',f),'utf8')).join('');
      assert.match(xml,/name="works/); assert.doesNotMatch(xml,/name="excluded/);
      r=await invoke(command); assert.equal(r.status,0,r.stdout+r.stderr); assert.match(r.stdout,/Reusing configuration cache/);
    }
    r=await invoke(`${base} test --tests '*DownloadModalComponentTest' --tests '*CacheServiceTest' -PfastTest --build-cache -q`); assert.equal(r.status,0,r.stdout+r.stderr);
    // Distinct canonical path gate is tested even through a symlinked cwd by Gradle's canonicalFile.
    assert.equal(existsSync(caches),cacheStat);
    if(forksHash) assert.equal(hash(readFileSync(maxForks)),forksHash);
  } finally {
    assert.equal(await stopGradle(area,[ws,unrelated]),true,'owned daemons finish before guard removal');
    assert.equal(removeGradleGuard(g),true,'owned init guard cleanup');
    rmSync(path.join(area,'gradle-check'),{recursive:true,force:true});
  }
}
