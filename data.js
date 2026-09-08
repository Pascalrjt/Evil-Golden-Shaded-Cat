/* All pickup conditions and walk times are simulated study fixtures.
   Candidate kerb coordinates: BCC passenger-loading sign records, checked 8 Sep 2026.
   Sign locations are indicative; this prototype does not provide live stopping advice. */
const PROTOTYPE_VERSION = "passenger-study-2026-09-08";
const CBD_CENTER = [-27.4698, 153.0251];
const DEFAULT_GPS_POSITION = [-27.469807, 153.025242];
const CBD_BOUNDS = [[-27.479,153.013],[-27.461,153.036]];
const WALK_METRES_PER_MINUTE = 60;
const SNAP_METRES = 25;
const DRIVER_POSITION = [-27.4738,153.0265];
const DRIVER_NAME = "Jordan";
const PASSENGER_NAME = "Mia";
const STATUS_LABEL = { suitable:"Suitable for pickup", caution:"Pickup may be difficult", blocked:"Pickup not recommended", unknown:"No pickup data for this spot" };
const LIFECYCLE = ["unreported","reported","temporary","verified","corrected","expired"];
const LOCATION_SOURCE = "https://data.brisbane.qld.gov.au/explore/dataset/two-minute-passenger-loading-zones/table/";
function fixture(id,name,address,coordinates,area,status="suitable",state="verified",reason="Clear kerb space for passenger pickup",reportCount=3,ageText="8 minutes ago",councilId=null) {
 return { id,name,address,coordinates,area,status,state,reason,reportCount,ageText,driverEta:4,councilId,locationSource:councilId?LOCATION_SOURCE:"Scenario landmark, indicative position", simulated:true };
}
const SPOT_FIXTURE = [
 fixture("pancake","Pancake Manor","18 Charlotte Street, venue frontage",[-27.47245,153.02547],"restaurants","suitable","verified","Clear kerb space for passenger pickup",4,"12 minutes ago"),
 fixture("queen-street","Hungry Jack’s, Queen Street Mall","Mall frontage near Albert Street",[-27.469807,153.025242],"restaurants","blocked","verified","Pedestrian mall access restricts vehicle pickup here",4,"12 minutes ago"),
 fixture("maru","Maru Korean Restaurant","157 Elizabeth Street, venue frontage",[-27.46959,153.02693],"restaurants","caution","temporary","Construction work is reducing kerb space",1,"3 days ago"),
 fixture("ann-street","Central Station, Ann Street","Station entrance, Ann Street side",[-27.46663,153.02614],"central","suitable","verified","Clear kerb access outside the station",4,"12 minutes ago"),
 fixture("wendys","Wendy’s, Albert / Adelaide","Albert Street frontage at Adelaide Street",[-27.46870,153.02452],"wendys","caution","verified","Driver cannot legally stop here",3,"8 minutes ago"),
 fixture("qut","QUT Gardens Point, George Street","Campus entrance at George and Alice Streets",[-27.47500,153.02742],"qut","caution","verified","Driver cannot legally stop here",3,"8 minutes ago"),
 fixture("charlotte-local","Charlotte Street","Between George and Albert Streets",[-27.471828,153.025794],"restaurants","suitable","verified","Clear kerb space for passenger pickup",3,"8 minutes ago",4543),
 fixture("elizabeth-street","Uptown, Elizabeth Street","Elizabeth Street frontage",[-27.470574,153.025695],"restaurants","suitable","verified","Clear kerb space beside the street entrance",4,"12 minutes ago",10050),
 fixture("george-street","George Street, Charlotte end","Between Elizabeth and Charlotte Streets",[-27.472163,153.024784],"restaurants","caution","temporary","A delivery vehicle is reducing available kerb space",1,"20 minutes ago",366),
 fixture("mary-local","Mary Street","Between George and Albert Streets",[-27.472600,153.026509],"restaurants","caution","expired","Earlier obstruction information needs checking",1,"2 days ago",473),
 fixture("adelaide-street","Adelaide Street, City Hall","Near City Hall",[-27.469480,153.023825],"wendys","suitable","verified","Clear kerb space for passenger pickup",3,"8 minutes ago",4390),
 fixture("ann-albert","Ann Street, Albert end","Near Albert Street",[-27.467696,153.024434],"wendys","suitable","verified","Clear kerb space beside the street entrance",3,"8 minutes ago",1212),
 fixture("george-adelaide","George Street, Adelaide end","Between Adelaide and Ann Streets",[-27.469318,153.022017],"wendys","caution","verified","Passing traffic may make pickup slower",3,"8 minutes ago",3636),
 fixture("edward-central","Edward Street, Central area","Between Ann and Adelaide Streets",[-27.467400,153.025909],"central","suitable","verified","Clear kerb space for passenger pickup",3,"8 minutes ago",13866),
 fixture("turbot-central","Turbot Street, Sofitel area","Near Sofitel Brisbane Central",[-27.465711,153.025307],"central","suitable","verified","Clear kerb space near the hotel approach",4,"12 minutes ago",12353),
 fixture("ann-creek","Ann Street, Creek end","Near Creek Street",[-27.465889,153.026804],"central","caution","temporary","Passing traffic may make pickup slower",1,"25 minutes ago",13695),
 fixture("george-qut","George Street, Alice end","Between Margaret and Alice Streets",[-27.474375,153.026776],"qut","suitable","verified","Clear kerb space for passenger pickup",3,"8 minutes ago",9765),
 fixture("alice-qut","Alice Street, Gardens side","Between George and Albert Streets",[-27.474512,153.027471],"qut","suitable","verified","Clear kerb space beside the street entrance",3,"8 minutes ago",8431),
 fixture("william-qut","William Street, Alice end","Near Alice Street",[-27.475043,153.026167],"qut","caution","verified","Passing traffic may make pickup slower",3,"8 minutes ago",4993),
 fixture("eagle-street","Eagle Street Pier","Riverside area, legacy driver demo",[-27.46807,153.03018],"riverside","blocked","verified","Road closed for a simulated event",3,"25 minutes ago"),
];
const GAZETTEER = [
 {name:"Pancake Manor",address:"18 Charlotte Street",spotId:"pancake"},
 {name:"Hungry Jack's",address:"Queen Street Mall near Albert Street",spotId:"queen-street"},
 {name:"Maru",address:"157 Elizabeth Street",spotId:"maru"},
 {name:"Central Station",address:"Ann Street entrance",spotId:"ann-street"},
 {name:"Wendy's",address:"Albert / Adelaide Street frontage",spotId:"wendys"},
 {name:"QUT Gardens Point",address:"George Street entrance",spotId:"qut"},
 {name:"Myer Centre / Uptown",address:"Elizabeth Street pickup frontage",spotId:"elizabeth-street"},
 {name:"Brisbane City Hall",address:"Adelaide Street pickup candidate",spotId:"adelaide-street"},
 {name:"Anzac Square",address:"Edward Street pickup candidate",spotId:"edward-central"},
 {name:"Sofitel Brisbane Central",address:"Turbot Street pickup candidate",spotId:"turbot-central"},
];
const REPORT_REASONS = [
  { value: "Good pickup spot", status: "suitable", icon: "circle-check-big", driverOnly: true },
  { value: "No-stopping zone", status: "blocked", icon: "circle-slash-2" },
  { value: "Road closure", status: "blocked", icon: "construction" },
  { value: "Heavy traffic", status: "caution", icon: "traffic-cone" },
  { value: "Limited access", status: "caution", icon: "accessibility" },
  { value: "Unsafe roadside", status: "blocked", icon: "shield-alert" },
  { value: "Construction or event", status: "caution", icon: "calendar-clock" },
];


const BREAK_CONDITIONS = ["interrupt_mid_report","conflicting_reports","duplicate_report","report_failure","bad_report_target","reload","bad_location_data"];
const LOCAL_ALTERNATIVES = {
 restaurants:["charlotte-local","elizabeth-street","george-street","mary-local"],
 wendys:["adelaide-street","ann-albert","george-adelaide"],
 central:["edward-central","turbot-central","ann-creek"],
 qut:["george-qut","alice-qut","william-qut"],
 riverside:["ann-creek","turbot-central","edward-central"]
};
const SCENARIO_DEFAULTS = { role:"passenger",entry:"search",suggestions:"full",suggestionsExpanded:false,variant:"explained",pressure:false,presetSpot:"queen-street",walkOverrides:{},driverScreen:"request",alternativeSpot:"edward-central",study:false,limitSeconds:180 };
function passengerTask(label,task,presetSpot,limitSeconds=180) {
 return {label,task,presetSpot,study:true,limitSeconds,location:SPOT_FIXTURE.find(s=>s.id===presetSpot).name};
}
const SCENARIOS = {
 FREE:{label:"Free exploration",task:"Explore the simulated map and reporting flow."},
 P0:passengerTask("Practice · Pancake Manor","Search for Pancake Manor, inspect its pickup information and confirm your chosen pickup. Familiarisation only; after two minutes demonstrate once if needed.","pancake",120),
 P1:passengerTask("Verified restriction · Hungry Jack’s","Search for Hungry Jack’s on Queen Street Mall near Albert Street. Inspect the information, choose your pickup and confirm it. An intentional override is a completed interaction.","queen-street"),
 P2:passengerTask("Older unverified warning · Maru","Search for Maru at 157 Elizabeth Street. Inspect the information, choose your pickup and confirm it.","maru"),
 P3:passengerTask("Staged obstruction · Central Station","Search for Central Station’s Ann Street entrance and inspect the information. After the participant indicates inspection, reveal: temporary barriers are blocking the kerb. Ask them to report what they observe and then choose and confirm a pickup. Pause only during the obstruction script.","ann-street"),
 "R2-T1":{label:"Technical · report",entry:"preset",task:"Audit report attempts, validation, acceptance and state changes."},
 "R2-T2":{label:"Technical · verify",entry:"preset",presetSpot:"maru",task:"Verify a temporary report and inspect the log."},
 "R2-T3":{label:"Technical · correct",entry:"preset",task:"Correct verified information and inspect the log."},
 "R2-T4":{label:"Technical · expire",entry:"preset",task:"Expire information and inspect the log. P3-E uses its separate static card."},
 "R3-1":{label:"Driver · confirmed spot",role:"driver",driverScreen:"request",task:"Inspect driver pickup information."},
 "R3-2":{label:"Driver · passenger relocated",role:"driver",driverScreen:"accepted-alternative",task:"Inspect the alternative pickup."},
 "R3-3":{label:"Driver · passenger kept pin",role:"driver",driverScreen:"kept-pin",task:"Inspect the retained pickup warning."},
};
for (const location of ["wendys","qut"]) {
 for (const condition of ["EXP","NOEXP"]) {
  SCENARIOS[`P4-${location.toUpperCase()}-${condition}`] = {
   ...passengerTask(`Relocation · ${location === "wendys" ? "Wendy’s" : "QUT"} · ${condition}`,"Reveal the screen, read the late-for-pickup script, then mark task start and start the separate two-minute arrival timer. Allow three continuous minutes for the decision. No think-aloud. Neutral prompt after 20 seconds if needed; record exact wording. Give the six-item form immediately after confirmation or timeout, before probes.",location),
   p4:true,entry:"preset",suggestionsExpanded:true,variant:condition==="EXP"?"explained":"unexplained",
   alternativeIds:LOCAL_ALTERNATIVES[location],walkOverrides:Object.fromEntries(LOCAL_ALTERNATIVES[location].map(id=>[id,3]))
  };
 }
}
const STUDY_GROUPS = {
 A:["P4-WENDYS-EXP","P4-QUT-NOEXP"], B:["P4-WENDYS-NOEXP","P4-QUT-EXP"],
 C:["P4-QUT-EXP","P4-WENDYS-NOEXP"], D:["P4-QUT-NOEXP","P4-WENDYS-EXP"]
};
const SCENARIO_ALIASES = {"R1-A":"P0","R1-B":"P1","R1-C":"P3","R4-EXP":"P4-WENDYS-EXP","R4-NOEXP":"P4-WENDYS-NOEXP"};
function getScenario(id) {
 id=SCENARIO_ALIASES[id] || id;
 const base={...SCENARIO_DEFAULTS,...(SCENARIOS[id] || SCENARIOS.FREE)};
 base.id=SCENARIOS[id]?id:"FREE";
 return base;
}
