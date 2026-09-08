const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const crypto=require('node:crypto').webcrypto;
function harness() {
 let now=1_000_000;
 const elements=new Map();
 function el(key) {if (!elements.has(key)) elements.set(key,{value:'',checked:false,hidden:true,options:[],dataset:{},innerHTML:'',textContent:'',open:false,addEventListener(){},querySelectorAll(){return[];},querySelector(){return null;},classList:{add(){},remove(){},toggle(){}},getBoundingClientRect(){return{top:0,bottom:50,height:800};},clientHeight:800,clientWidth:400,style:{setProperty(){}},close(){this.open=false;},show(){this.open=true;},focus(){},scrollIntoView(){},append(){}}); return elements.get(key);}
 const chain=new Proxy({}, {get:(_,key)=>['getNorth','getSouth','getWest'].includes(key)?()=>0:key==='getSize'?()=>({x:400,y:800}):()=>chain});
 const context=vm.createContext({console,crypto,structuredClone,URLSearchParams,Date:class extends Date {constructor(...v){super(...(v.length?v:[now]));}static now(){return now;}},navigator:{userAgent:'test-device'},document:{querySelector:el,querySelectorAll:()=>[],dispatchEvent(){},addEventListener(){},createElement:()=>el('new')},CustomEvent:class{},localStorage:{getItem(){return null;},setItem(){}},window:{setInterval(){},setTimeout(){},addEventListener(){},location:{search:'',pathname:'/',reload(){}},history:{replaceState(){}}},L:new Proxy({}, {get:()=>()=>chain}),FormData:class{get(){return el('reason').value;}}});
 for(const file of ['data.js','log.js','study.js','app.js']) vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8').replace(/\nboot\(\);\s*$/,''),context,{filename:file});
 vm.runInContext('render=()=>{}; setSheet=()=>{}; focusPickup=()=>{}; centreMapOnUserPosition=()=>{}; refreshIcons=()=>{}; showToast=()=>{};',context);
 const run=code=>vm.runInContext(code,context);
 return {run,el,advance:ms=>{now+=ms;},load:(id,group=id==='P4-QUT-EXP'?'C':id==='P4-QUT-NOEXP'?'D':id==='P4-WENDYS-NOEXP'?'B':'A')=>run(`loadScenario(${JSON.stringify(id)},"TEST",null,1,{group:${JSON.stringify(group)}})`),start:()=>run('startTask()'),json:code=>JSON.parse(run(`JSON.stringify(${code})`))};
}
test('confirming a snapped map pin shows the start controls, then advances once running',()=>{
 const h=harness();h.load('P1');
 h.run('resolveCentre=()=>({coords:getSpot("george-street").coordinates,nearest:{spot:getSpot("george-street"),distance:0},inside:true})');
 h.run('confirmCentre()');assert.equal(h.el('#facilitator').hidden,false);assert.equal(h.run('state.ui.screen'),'locate');assert.equal(h.run('state.attempt.startedAt'),null);
 h.start();h.run('confirmCentre()');assert.equal(h.run('state.ui.screen'),'pickup');assert.equal(h.run('state.ui.selectedSpotId'),'george-street');assert.equal(h.run('state.attempt.status'),'running');
});
test('recenter uses the simulated position before and during a study task',()=>{
 const h=harness();h.load('P0');
 h.run('var recentered=[];centreMapOnUserPosition=(position)=>recentered.push([...position]);navigator.geolocation={getCurrentPosition(){throw new Error("Unexpected GPS request");}}');
 h.run('recenterPassengerPosition()');assert.equal(h.run('state.attempt.status'),'ready');
 h.start();h.run('recenterPassengerPosition()');
 assert.deepEqual(h.json('recentered'),[h.json('state.ui.userPosition'),h.json('state.ui.userPosition')]);
 h.run('finishTask("facilitator_stop");recenterPassengerPosition()');assert.equal(h.run('recentered.length'),2);
});
test('all fixture candidates are distinct, local and searchable; P4 profiles match',()=>{
 const h=harness(); assert.equal(h.run('SPOT_FIXTURE.length'),20);
 assert.equal(h.run('new Set(SPOT_FIXTURE.map(s=>s.id)).size'),20);
 for(const location of ['WENDYS','QUT']) for(const cond of ['EXP','NOEXP']) {
  h.load(`P4-${location}-${cond}`);
  assert.deepEqual(h.json('alternativesFor(selectedSpot()).map(a=>[a.spot.status,a.walk,a.spot.reportCount,a.spot.ageText])'),[['suitable',3,3,'8 minutes ago'],['suitable',3,3,'8 minutes ago'],['caution',3,3,'8 minutes ago']]);
  assert.equal(h.run('state.session.useGps'),false);
 }
 h.load('P1'); assert.equal(h.run('searchGazetteer("hungry jacks")[0].spotId'),'queen-street');
 assert.equal(h.run('searchGazetteer("qut").length'),0);
});
test('NOEXP withholds the bundle in list, override, confirmation and report updates',()=>{
 const h=harness(); h.load('P4-WENDYS-NOEXP');h.start();
 for(const phase of ['list','override','reported','confirmation']){
  if(phase==='override')h.run('state.ui.overridePending=true');
  if(phase==='reported'){h.run('state.ui.overridePending=false;openReport({mode:"report",actor:"passenger",spotId:"wendys"})');h.el('reason').value='Limited access';h.run('handleReportSubmit({preventDefault(){}})');}
  const html=h.run(phase==='confirmation'?'passengerConfirmedTemplate(selectedSpot())':'passengerPickupTemplate(selectedSpot())');
  assert.doesNotMatch(html,/Source:|Verified by|passenger report|Limited kerb access reported|Driver cannot legally stop here|Step-free|Stairs nearby|Driver arrives/);
 }
 assert.equal(h.run('displayedSnapshot(selectedSpot()).reason'),null);
 assert.ok(h.run('spotSnapshot(selectedSpot()).reason'));
});
test('P4 records a final intentional override separately from suitability',()=>{
 const h=harness();h.load('P4-QUT-EXP');h.start();h.advance(12345);h.run('requestPickupOverride();confirmPickup("override")');
 const s=h.json('state.attempt.summary');assert.equal(s.task_outcome,'independent');assert.equal(s.chosen_pickup_suitability,'caution');assert.equal(s.decision,'override');assert.equal(s.elapsed_ms,12345);
 assert.equal(h.run('canGoBack()'),false);h.run('confirmPickup("override")');assert.equal(h.run('EventLog.all().filter(e=>e.event==="task_ended").length'),1);
});
test('P4 records chosen alternative snapshot and underlying/displayed information separately',()=>{
 const h=harness();h.load('P4-WENDYS-NOEXP');h.start();h.run('chooseAlternative("george-adelaide")');assert.equal(h.run('state.attempt.status'),'running');h.run('confirmPickup("alternative")');
 const s=h.json('EventLog.summaries()[0]');assert.equal(s.decision,'accept');assert.equal(s.chosen_pickup_suitability,'caution');assert.equal(s.displayed.reason,null);assert.ok(s.chosen.reason);assert.match(h.run('EventLog.summaryCSV()'),/chosen_pickup_suitability/);
});
test('P3 requires inspection, reveal and accepted report, preserving previous evidence',()=>{
 const h=harness();h.load('P3');h.start();h.run('placePin("ann-street",null,"search")');h.run('confirmPickup("original")');assert.equal(h.run('state.attempt.status'),'running');
 h.advance(10000);h.run('markInspection();revealObstruction()');assert.equal(h.run('selectedSpot().status'),'suitable');assert.equal(h.run('canGoBack()'),false);
 h.advance(15000);h.run('finishReveal()');h.advance(5000);h.run('openReport({mode:"report",actor:"passenger",spotId:"ann-street"})');h.el('reason').value='Construction or event';h.run('handleReportSubmit({preventDefault(){}})');
 assert.equal(h.run('state.attempt.status'),'running');assert.equal(h.run('state.attempt.reportAccepted'),true);assert.equal(h.run('selectedSpot().status'),'caution');assert.match(h.run('freshnessText(selectedSpot())'),/One passenger report, just now/);assert.equal(h.run('selectedSpot().history[0].report_count'),4);
 h.advance(7000);h.run('chooseAlternative("edward-central");confirmPickup("alternative")');const s=h.json('state.attempt.summary');assert.equal(s.elapsed_ms,22000);assert.equal(s.script_pause_ms,15000);assert.equal(s.task_outcome,'independent');assert.equal(s.chosen_pickup_suitability,'suitable');
});
test('timeouts use the exact deadline and leave no confirmed pickup; no decision at two minutes is allowed',()=>{
 const h=harness();h.load('P4-QUT-NOEXP');h.start();h.advance(120000);h.run('checkStudyDeadline()');assert.equal(h.run('state.attempt.status'),'running');h.advance(70000);h.run('checkStudyDeadline()');const s=h.json('state.attempt.summary');assert.equal(s.elapsed_ms,180000);assert.equal(s.decision,'no_decision');assert.equal(s.chosen_pickup_suitability,'no_confirmed_choice');assert.equal(s.abandoned,false);
});
test('missing category, bad target, failure and duplicate do not mutate accepted state',()=>{
 const h=harness();h.load('R2-T1');h.run('openReport({mode:"report",actor:"passenger",spotId:"queen-street"})');h.run('handleReportSubmit({preventDefault(){}})');assert.equal(h.run('selectedSpot().reports.length'),0);assert.match(h.el('#report-error').textContent,/Choose a category/);
 h.el('reason').value='Construction or event';h.run('state.ui.badReportTarget=true;handleReportSubmit({preventDefault(){}})');assert.equal(h.run('selectedSpot().reports.length'),0);
 h.run('state.ui.badReportTarget=false;state.ui.failNextReport=true;handleReportSubmit({preventDefault(){}})');assert.equal(h.run('selectedSpot().reports.length'),0);h.run('handleReportSubmit({preventDefault(){}})');assert.equal(h.run('selectedSpot().reports.length'),1);
 h.el('#fac-break').value='duplicate_report';h.run('applyTechnicalFault()');assert.equal(h.run('selectedSpot().reports.length'),1);assert.equal(h.run('EventLog.all().filter(e=>e.event==="report_rejected").length'),4);
});
test('resets preserve old rows and remove prior reports, choices and timers',()=>{
 const h=harness();h.load('P4-WENDYS-EXP');h.start();h.run('chooseAlternative("ann-albert")');const id=h.run('state.attempt.id');h.run('loadScenario("P4-WENDYS-EXP","TEST",null,1,{reset:true})');assert.notEqual(h.run('state.attempt.id'),id);assert.equal(h.run('state.session.attemptKind'),'retry');assert.equal(h.run('state.ui.chosenAlternativeId'),null);assert.equal(h.run('state.attempt.startedAt'),null);assert.equal(h.run('EventLog.summaries().filter(r=>r.attempt_kind!=="planned").length'),2);
});
test('all groups balance order and a participant can abandon independently of suitability',()=>{
 const h=harness();assert.deepEqual(h.json('STUDY_GROUPS.C'),['P4-QUT-EXP','P4-WENDYS-NOEXP']);h.load('P2');h.start();h.run('finishTask("abandoned")');assert.equal(h.run('state.attempt.summary.task_outcome'),'abandoned');assert.equal(h.run('state.attempt.summary.chosen_pickup_suitability'),'no_confirmed_choice');
});
test('mismatched P4 allocation cannot start and missing assigned trials remain unstarted',()=>{
 const h=harness();h.load('P4-QUT-EXP','A');h.start();assert.equal(h.run('state.attempt.status'),'ready');
 const planned=h.json('EventLog.summaries().filter(r=>r.attempt_kind==="planned")');assert.equal(planned.length,2);assert.ok(planned.every(r=>!r.started && r.attempt_id===null));
});
test('assistance stop is separate from abandonment and reset clears accepted reports',()=>{
 const h=harness();h.load('P1');h.start();h.el('#fac-observation-type').value='assistance';h.el('#fac-observation-note').value='Please use the search field';h.run('recordObservation()');h.el('#fac-observation-note').value='Select the matching venue';h.run('recordObservation()');assert.equal(h.run('state.attempt.summary.stop_reason'),'assistance_limit');assert.equal(h.run('state.attempt.summary.abandoned'),false);
 h.load('R2-T1');h.run('openReport({mode:"report",actor:"passenger",spotId:"queen-street"})');h.el('reason').value='Limited access';h.run('handleReportSubmit({preventDefault(){}})');h.run('loadScenario("R2-T1","TEST",null,1,{reset:true})');assert.equal(h.run('selectedSpot().reports.length'),0);assert.equal(h.run('selectedSpot().history.length'),0);
});
test('guided controls expose prepare, start and next at the correct stages',()=>{
 const h=harness();h.run('changeMode("study");renderStudyControls()');
 assert.equal(h.el('#fac-setup').hidden,false);assert.equal(h.el('#fac-start-task').hidden,true);assert.equal(h.el('#fac-next').hidden,true);
 h.el('#fac-pid').value='GUIDED';h.el('#fac-group').value='C';h.run('prepareSession();renderStudyControls()');
 assert.equal(h.run('state.scenario.id'),'P0');assert.equal(h.el('#fac-setup').hidden,true);assert.equal(h.el('#fac-start-task').hidden,false);
 h.start();h.run('renderStudyControls()');assert.equal(h.el('#fac-start-task').hidden,true);assert.equal(h.el('#fac-stop-task').hidden,false);assert.equal(h.el('#fac-next').hidden,true);
 h.run('finishTask("facilitator_stop");renderStudyControls()');assert.equal(h.el('#fac-next').hidden,false);assert.equal(h.el('#fac-stop-task').hidden,true);
 h.run('loadNextTask();renderStudyControls()');assert.equal(h.run('state.scenario.id'),'P1');assert.equal(h.el('#fac-start-task').hidden,false);
});
test('preview is interactive without timing and excluded from summaries, then study starts fresh',()=>{
 const h=harness();h.run('changeMode("preview");placePin("pancake",null,"map")');assert.equal(h.run('state.ui.screen'),'pickup');assert.equal(h.run('state.attempt.startedAt'),null);
 h.advance(500000);h.run('checkStudyDeadline()');assert.equal(h.run('state.attempt.status'),'running');
 h.run('confirmPickup("original")');assert.equal(h.run('state.ui.screen'),'confirmed');assert.equal(h.run('EventLog.summaries().length'),0);
 assert.ok(h.json('EventLog.all()').every(e=>e.mode==='preview'));
 const previewSession=h.run('state.session.id');h.run('changeMode("study")');h.el('#fac-pid').value='REAL';h.el('#fac-group').value='A';h.run('prepareSession()');
 assert.notEqual(h.run('state.session.id'),previewSession);assert.equal(h.run('state.ui.selectedSpotId'),null);assert.equal(h.run('state.attempt.startedAt'),null);
 h.start();assert.equal(h.run('EventLog.summaries().filter(r=>r.started).length'),1);
});
test('preview preserves P3 reveal and reporting stages without a timeout',()=>{
 const h=harness();h.run('loadScenario("P3","PREVIEW",null,1,{mode:"preview",prepared:false});placePin("ann-street",null,"map");markInspection();revealObstruction()');assert.equal(h.run('state.attempt.p3Stage'),'reveal');
 h.advance(500000);h.run('finishReveal();openReport({mode:"report",actor:"passenger",spotId:"ann-street"})');h.el('reason').value='Limited access';h.run('handleReportSubmit({preventDefault(){}});chooseAlternative("edward-central");confirmPickup("alternative")');
 assert.equal(h.run('state.ui.screen'),'confirmed');assert.equal(h.run('EventLog.summaries().length'),0);
});
test('end task needs a reason and running studies cannot switch modes',()=>{
 const h=harness();h.load('P1');h.start();h.run('changeMode("preview")');assert.equal(h.run('state.session.mode'),'study');
 h.el('#fac-end-reason').value='';h.run('confirmTaskEnd()');assert.equal(h.run('state.attempt.status'),'running');
 h.el('#fac-end-reason').value='abandoned';h.run('confirmTaskEnd()');assert.equal(h.run('state.attempt.summary.task_outcome'),'abandoned');
});
test('skip before start requires a reason and advances without creating a started attempt',()=>{
 const h=harness();h.load('P0');h.run('renderStudyControls();openSkipScenario();confirmScenarioSkip()');
 assert.equal(h.el('#fac-start-task').hidden,false);assert.equal(h.el('#fac-skip-task').hidden,false);assert.equal(h.run('state.scenario.id'),'P0');
 h.el('#fac-skip-reason').value='Already familiar with the interface';h.run('confirmScenarioSkip()');
 const row=h.json('EventLog.summaries().find(r=>r.scenario_id==="P0")');assert.equal(row.task_outcome,'skipped_before_start');assert.equal(row.started,false);assert.equal(row.elapsed_ms,null);assert.equal(row.skip_reason,'Already familiar with the interface');assert.equal(row.abandoned,false);
 assert.equal(h.run('state.scenario.id'),'P1');assert.equal(h.run('state.attempt.status'),'ready');assert.equal(h.run('EventLog.all().filter(e=>e.event==="task_started").length'),0);
 h.run('confirmScenarioSkip()');assert.equal(h.run('state.scenario.id'),'P1');
});
test('skip after start retains activity and elapsed time while advancing to the next assigned P4',()=>{
 const h=harness();h.load('P4-WENDYS-EXP');h.start();h.run('chooseAlternative("ann-albert");renderStudyControls()');assert.equal(h.el('#fac-stop-task').hidden,false);assert.equal(h.el('#fac-skip-task').hidden,false);
 h.advance(18000);h.run('openSkipScenario()');h.el('#fac-skip-reason').value='Session running short';h.advance(2000);h.run('confirmScenarioSkip()');
 const row=h.json('EventLog.summaries().find(r=>r.scenario_id==="P4-WENDYS-EXP")');assert.equal(row.task_outcome,'skipped_after_start');assert.equal(row.started,true);assert.equal(row.elapsed_ms,20000);assert.equal(row.confirmation_occurred,false);assert.equal(row.p4_comparison_incomplete,true);
 assert.equal(h.run('EventLog.all().filter(e=>e.event==="alternative_selected").length'),1);assert.equal(h.run('state.scenario.id'),'P4-QUT-NOEXP');assert.equal(h.run('state.session.orderPosition'),2);assert.equal(h.run('state.session.group'),'A');assert.match(h.run('EventLog.summaryCSV()'),/skip_reason,p4_comparison_incomplete/);
});
test('skipping the last scenario completes the sequence and an expired attempt remains a timeout',()=>{
 const h=harness();h.run('loadScenario("P4-QUT-NOEXP","LAST",null,2,{group:"A"});openSkipScenario()');h.el('#fac-skip-reason').value='Participant unavailable';h.run('confirmScenarioSkip();renderStudyControls()');
 assert.equal(h.run('state.scenario.id'),'P4-QUT-NOEXP');assert.equal(h.run('state.attempt.status'),'ended');assert.equal(h.el('#fac-sequence-complete').hidden,false);assert.equal(h.el('#fac-skip-task').hidden,true);
 h.load('P1');h.start();h.run('openSkipScenario()');h.el('#fac-skip-reason').value='Too late';h.advance(180001);h.run('confirmScenarioSkip()');assert.equal(h.run('state.attempt.summary.stop_reason'),'timeout');assert.equal(h.run('state.scenario.id'),'P1');
});
test('skipping during the P3 script retains the pause and skip is absent from preview',()=>{
 const h=harness();h.load('P3');h.start();h.advance(5000);h.run('placePin("ann-street",null,"map");markInspection();revealObstruction()');h.advance(10000);h.run('openSkipScenario()');h.el('#fac-skip-reason').value='Stop this scenario';h.run('confirmScenarioSkip()');
 const row=h.json('EventLog.summaries().find(r=>r.scenario_id==="P3")');assert.equal(row.elapsed_ms,5000);assert.equal(row.script_pause_ms,10000);assert.equal(row.task_outcome,'skipped_after_start');
 h.run('changeMode("preview");renderStudyControls();openSkipScenario()');assert.equal(h.el('#fac-skip-task').hidden,true);assert.equal(h.run('canSkipScenario()'),false);
});
test('suitable pickups suppress relocation controls across study, preview and technical modes',()=>{
 const h=harness();
 for (const mode of ['study','preview','technical']) {
  h.run(`loadScenario("${mode==='technical'?'FREE':'P1'}","UI",null,1,{mode:"${mode}"})`);if(mode==='study')h.start();
  h.run('placePin("charlotte-local",null,"map");state.ui.suggestionsOpen=true;state.ui.chosenAlternativeId="george-street";state.ui.overridePending=true;syncPassengerPickupState()');
  const html=h.run('passengerPickupTemplate(selectedSpot())');assert.match(html,/id="confirm-pin"/);assert.match(html,/Report a problem here/);assert.doesNotMatch(html,/id="(?:open-suggestions|toggle-suggestions|keep-pin|override-confirm|confirm-alternative)"|data-alt=/);
  h.run('toggleSuggestions(true);chooseAlternative("george-street");onPinTap("george-street");requestPickupOverride()');assert.equal(h.run('state.ui.chosenAlternativeId'),null);assert.equal(h.run('state.ui.suggestionsOpen'),false);assert.equal(h.run('state.ui.overridePending'),false);
 }
});
test('warning, unknown and empty-alternative states offer a usable next action',()=>{
 const h=harness();h.load('R2-T1');
 for(const status of ['caution','blocked','unknown']) {
  h.run(`selectedSpot().status="${status}";state.ui.overridePending=false;state.ui.suggestionsOpen=false`);
  const html=h.run('passengerPickupTemplate(selectedSpot())');assert.match(html,/id="open-suggestions"/);assert.match(html,/id="keep-pin"/);assert.doesNotMatch(html,/id="confirm-pin"/);
  h.run('requestPickupOverride()');const override=h.run('passengerPickupTemplate(selectedSpot())');assert.match(override,/id="override-confirm"/);assert.doesNotMatch(override,/id="(?:open-suggestions|open-report|confirm-pin|confirm-alternative|keep-pin)"/);
  if(status==='unknown')assert.match(override,/availability here is unconfirmed/);
 }
 h.run('state.ui.overridePending=false;state.scenario.alternativeIds=[];syncPassengerPickupState()');assert.match(h.run('passengerPickupTemplate(selectedSpot())'),/No suggested alternatives are available/);assert.equal(h.run('passengerPickupState().canSuggest'),false);assert.equal(h.run('passengerPickupState().canKeep'),true);
});
test('status changes clear stale relocation state and reopen alternatives after a new obstruction',()=>{
 const h=harness();h.load('R2-T1');h.run('chooseAlternative("charlotte-local");getSpot("queen-street").status="suitable";syncPassengerPickupState()');
 assert.equal(h.run('state.ui.chosenAlternativeId'),null);assert.equal(h.run('passengerPickupState().canConfirmOriginal'),true);
 h.run('openReport({mode:"report",actor:"passenger",spotId:"queen-street"})');h.el('reason').value='Limited access';h.run('handleReportSubmit({preventDefault(){}});syncPassengerPickupState()');assert.equal(h.run('passengerPickupState().browsing'),true);assert.equal(h.run('passengerPickupState().canConfirmOriginal'),false);
});
test('P3 inspection and script pause block hidden shortcuts until the report stage',()=>{
 const h=harness();h.load('P3');h.start();h.run('placePin("ann-street",null,"map")');
 assert.match(h.run('passengerPickupTemplate(selectedSpot())'),/id="inspection-done"/);h.run('onPinTap("edward-central");chooseAlternative("edward-central");openReport({actor:"passenger",spotId:"ann-street",mode:"report"})');assert.equal(h.run('state.ui.chosenAlternativeId'),null);assert.equal(h.run('reportContext'),null);
 h.run('markInspection();revealObstruction()');assert.equal(h.run('passengerPickupState().canReport'),false);h.run('finishReveal()');assert.equal(h.run('passengerPickupState().canReport'),true);assert.equal(h.run('passengerPickupState().canSuggest'),false);
});
test('invalid locations and ended tasks expose no passenger mutation controls',()=>{
 const h=harness();h.load('P1');h.start();h.run('placePin("queen-street",null,"map");selectedSpot().coordinates=null');
 assert.match(h.run('passengerPickupTemplate(selectedSpot())'),/Location unavailable/);assert.doesNotMatch(h.run('passengerPickupTemplate(selectedSpot())'),/<button/);h.run('confirmPickup("original");requestPickupOverride();openReport({actor:"passenger",spotId:"queen-street"})');assert.equal(h.run('state.attempt.status'),'running');assert.equal(h.run('reportContext'),null);
 h.run('finishTask("facilitator_stop")');assert.equal(h.run('passengerPickupState().canSuggest'),false);assert.equal(h.run('passengerPickupState().canReport'),false);
});
test('P4 retains both suitable alternatives when comparing a cautionary original',()=>{
 const h=harness();for(const id of ['P4-WENDYS-EXP','P4-WENDYS-NOEXP']) {
  h.load(id);h.start();h.run('chooseAlternative("ann-albert")');const html=h.run('passengerPickupTemplate(selectedSpot())');assert.equal((html.match(/data-alt=/g)||[]).length,3);assert.match(html,/id="confirm-alternative"/);
  h.run('requestPickupOverride();onPinTap("adelaide-street")');assert.equal(h.run('state.ui.chosenAlternativeId'),'ann-albert');assert.equal(h.run('state.ui.overridePending'),true);
  h.run('confirmPickup("alternative")');assert.equal(h.run('state.attempt.status'),'running');h.run('confirmPickup("override")');assert.equal(h.run('state.attempt.summary.decision'),'override');
 }
});
test('driver relocation suggestions follow the current warning and candidate availability',()=>{
 const h=harness();h.load('R3-3');assert.equal(h.run('canDriverSuggest()'),true);h.run('selectedSpot().status="suitable"');assert.equal(h.run('canDriverSuggest()'),false);assert.doesNotMatch(h.run('driverTemplate()'),/id="driver-suggest"/);
 h.run('selectedSpot().status="caution";state.scenario.alternativeIds=[]');assert.equal(h.run('canDriverSuggest()'),false);h.run('selectedSpot().coordinates=null');assert.match(h.run('driverTemplate()'),/id="driver-confirm" disabled/);
});
