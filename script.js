const API_BASE = "https://api.frankfurter.dev/v2";

const currencies = [
  ["USD","US Dollar","🇺🇸","$"],["INR","Indian Rupee","🇮🇳","₹"],["EUR","Euro","🇪🇺","€"],
  ["GBP","British Pound","🇬🇧","£"],["JPY","Japanese Yen","🇯🇵","¥"],["CAD","Canadian Dollar","🇨🇦","C$"],
  ["AUD","Australian Dollar","🇦🇺","A$"],["CHF","Swiss Franc","🇨🇭","CHF"],["CNY","Chinese Yuan","🇨🇳","¥"],
  ["SGD","Singapore Dollar","🇸🇬","S$"],["AED","UAE Dirham","🇦🇪","د.إ"],["KRW","South Korean Won","🇰🇷","₩"],
  ["NZD","New Zealand Dollar","🇳🇿","NZ$"],["HKD","Hong Kong Dollar","🇭🇰","HK$"],["SEK","Swedish Krona","🇸🇪","kr"],
  ["NOK","Norwegian Krone","🇳🇴","kr"],["DKK","Danish Krone","🇩🇰","kr"],["ZAR","South African Rand","🇿🇦","R"],
  ["BRL","Brazilian Real","🇧🇷","R$"],["MXN","Mexican Peso","🇲🇽","$"],["THB","Thai Baht","🇹🇭","฿"],
  ["IDR","Indonesian Rupiah","🇮🇩","Rp"],["MYR","Malaysian Ringgit","🇲🇾","RM"],["PHP","Philippine Peso","🇵🇭","₱"],
  ["PLN","Polish Zloty","🇵🇱","zł"],["CZK","Czech Koruna","🇨🇿","Kč"],["HUF","Hungarian Forint","🇭🇺","Ft"],
  ["TRY","Turkish Lira","🇹🇷","₺"],["ILS","Israeli New Shekel","🇮🇱","₪"],["SAR","Saudi Riyal","🇸🇦","﷼"]
].map(([code,name,flag,symbol])=>({code,name,flag,symbol}));

const popularCodes = ["USD","INR","EUR","GBP","JPY","CAD","AUD","AED"];
const rangeDays = {"1D":2,"1W":7,"1M":30,"3M":90,"1Y":365,"5Y":1826};

const state = {
  from: getSavedPair().from || "INR",
  to: getSavedPair().to || "USD",
  pickerTarget: null,
  rate: null,
  previous: null,
  rateDate: null,
  history: [],
  range: "1M",
  calc: { display:"0", stored:null, operator:null, waiting:false, expression:"" },
  chart: null
};

function $(id){ return document.getElementById(id); }
function getCurrency(code){ return currencies.find(c=>c.code===code) || currencies[0]; }
function getSavedPair(){
  try { return JSON.parse(localStorage.getItem("cosmic-pair") || "{}"); }
  catch { return {}; }
}
function savePair(){
  localStorage.setItem("cosmic-pair", JSON.stringify({from:state.from,to:state.to}));
}
function formatAmount(amount, currency){
  if(!Number.isFinite(amount)) return "—";
  try{
    return new Intl.NumberFormat(undefined,{
      style:"currency",currency:currency.code,maximumFractionDigits:Math.abs(amount)<1?6:2
    }).format(amount);
  }catch{
    return `${currency.symbol}${amount.toLocaleString()}`;
  }
}
function formatRate(rate){
  return typeof rate==="number" && Number.isFinite(rate)
    ? rate.toLocaleString(undefined,{maximumSignificantDigits:8})
    : "—";
}
function cleanNumber(num){
  return Number.isFinite(num) ? String(Number(num.toPrecision(12))) : "Error";
}
function operate(a,b,op){
  if(op==="+") return a+b;
  if(op==="−") return a-b;
  if(op==="×") return a*b;
  if(op==="÷") return b===0 ? NaN : a/b;
  return b;
}
function handleCalcKey(key){
  const c = state.calc;
  if(/^\d$/.test(key)){
    if(c.waiting || c.display==="0" || c.display==="Error"){
      c.display=key;c.waiting=false;
    }else if(c.display.length<16){ c.display += key; }
  }else if(key==="."){
    if(c.waiting){ c.display="0.";c.waiting=false; }
    else if(!c.display.includes(".")){ c.display += "."; }
  }else if(key==="AC"){
    state.calc={display:"0",stored:null,operator:null,waiting:false,expression:""};
  }else if(key==="⌫"){
    if(!c.waiting) c.display = c.display.length>1 ? c.display.slice(0,-1) : "0";
  }else if(key==="+/−"){
    c.display = cleanNumber(-Number(c.display));
  }else if(key==="%"){
    c.display = cleanNumber(Number(c.display)/100);
  }else if(["+","−","×","÷"].includes(key)){
    const input=Number(c.display);
    let stored=c.stored;
    if(stored!==null && c.operator && !c.waiting) stored=operate(stored,input,c.operator);
    else stored=input;
    c.display=cleanNumber(stored);c.stored=stored;c.operator=key;c.waiting=true;c.expression=`${cleanNumber(stored)} ${key}`;
  }else if(key==="="){
    if(c.stored!==null && c.operator){
      const input=Number(c.display);
      const output=operate(c.stored,input,c.operator);
      c.display=cleanNumber(output);
      c.expression=`${c.stored} ${c.operator} ${input} =`;
      c.stored=null;c.operator=null;c.waiting=true;
    }
  }
  updateConversionUI();
}

async function fetchCurrentRate(){
  const from=state.from,to=state.to;
  $("loadingRate").classList.remove("hidden");
  state.rate=null; state.previous=null;
  updateConversionUI();

  if(from===to){
    state.rate=1;state.previous=1;state.rateDate=new Date().toISOString().slice(0,10);
    $("loadingRate").classList.add("hidden"); updateConversionUI(); updateChartStats(); return;
  }

  try{
    const res=await fetch(`${API_BASE}/rate/${from}/${to}`);
    if(!res.ok) throw new Error("Rate unavailable");
    const current=await res.json();
    state.rate=current.rate; state.rateDate=current.date;

    const d=new Date(`${current.date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate()-10);
    const start=d.toISOString().slice(0,10);
    const histRes=await fetch(`${API_BASE}/rates?from=${start}&base=${from}&quotes=${to}`);
    if(histRes.ok){
      const rows=await histRes.json();
      const prior=rows.filter(r=>r.date<current.date).at(-1);
      state.previous=prior?.rate ?? null;
    }
  }catch{
    state.rate=null;state.previous=null;state.rateDate=null;
  }finally{
    $("loadingRate").classList.add("hidden");
    updateConversionUI(); updateChartStats();
  }
}

async function fetchHistory(){
  const from=state.from,to=state.to;
  if(from===to){
    state.history=[{date:new Date(Date.now()-86400000).toISOString().slice(0,10),rate:1},{date:new Date().toISOString().slice(0,10),rate:1}];
    renderChart(); return;
  }

  const end=new Date(), start=new Date();
  start.setDate(end.getDate()-rangeDays[state.range]);
  const params=new URLSearchParams({
    from:start.toISOString().slice(0,10),
    to:end.toISOString().slice(0,10),
    base:from,
    quotes:to
  });
  if(state.range==="5Y") params.set("group","month");
  else if(state.range==="1Y") params.set("group","week");

  $("chartEmpty").classList.add("hidden");
  try{
    const res=await fetch(`${API_BASE}/rates?${params.toString()}`);
    if(!res.ok) throw new Error();
    const rows=await res.json();
    state.history=rows.map(r=>({date:r.date,rate:r.rate}));
    renderChart();
  }catch{
    state.history=[];
    if(state.chart){ state.chart.destroy(); state.chart=null; }
    $("chartEmpty").classList.remove("hidden");
  }
  updateChartStats();
}

function updateCurrencyUI(){
  const from=getCurrency(state.from),to=getCurrency(state.to);
  $("fromFlag").textContent=from.flag;$("fromCode").textContent=from.code;$("fromName").textContent=from.name;
  $("toFlag").textContent=to.flag;$("toCode").textContent=to.code;$("toName").textContent=to.name;
  $("pairLabel").textContent=`${from.code} / ${to.code}`;$("marketCode").textContent=to.code;
  $("chartFromFlag").textContent=from.flag;$("chartToFlag").textContent=to.flag;
  updateConversionUI(); updateChartStats();
}

function updateConversionUI(){
  const from=getCurrency(state.from),to=getCurrency(state.to), amount=Number(state.calc.display);
  $("expressionLabel").textContent=state.calc.expression || `${from.code} amount`;
  $("inputAmount").textContent=formatAmount(amount,from);

  if(typeof state.rate==="number" && Number.isFinite(amount)){
    const converted=amount*state.rate;
    $("convertedAmount").textContent=formatAmount(converted,to);
    $("conversionLine").textContent=`${formatAmount(amount,from)} ${from.code} = ${formatAmount(converted,to)} ${to.code}`;
    $("rateLine").textContent=`1 ${from.code} = ${formatRate(state.rate)} ${to.code}`;
  }else{
    $("convertedAmount").textContent="Exchange rate unavailable";
    $("conversionLine").textContent="Live conversion is currently unavailable.";
    $("rateLine").textContent="Exchange rate unavailable";
  }
}

function updateChartStats(){
  const change = state.previous && state.rate ? ((state.rate-state.previous)/state.previous)*100 : null;
  $("marketRate").textContent=formatRate(state.rate);
  const changeText = change===null ? "Change unavailable" : `${change>=0?"+":""}${change.toFixed(3)}% vs prior available day`;
  $("marketChange").textContent=changeText;
  $("marketChange").className = change===null ? "" : (change>=0 ? "positive" : "negative");
  $("statCurrent").textContent=state.rate?formatRate(state.rate):"Unavailable";
  $("statChange").textContent=change===null?"—":`${change>=0?"+":""}${change.toFixed(3)}%`;
  $("statChange").className=change===null?"":(change>=0?"positive":"negative");
  $("statDate").textContent=state.rateDate || "Unavailable";
  if(state.history.length){
    const vals=state.history.map(x=>x.rate);
    $("statHigh").textContent=formatRate(Math.max(...vals));
    $("statLow").textContent=formatRate(Math.min(...vals));
  }else{
    $("statHigh").textContent="—";$("statLow").textContent="—";
  }
}

function renderChart(){
  if(state.chart) state.chart.destroy();
  const ctx=$("rateChart");
  const change = state.previous && state.rate ? ((state.rate-state.previous)/state.previous)*100 : 0;
  const positive=change>=0;
  state.chart=new Chart(ctx,{
    type:"line",
    data:{
      labels:state.history.map(x=>x.date),
      datasets:[{
        data:state.history.map(x=>x.rate),
        borderColor:positive?"#72eeb0":"#ff8594",
        backgroundColor:"transparent",
        borderWidth:3,
        pointRadius:0,
        pointHoverRadius:5,
        tension:.35,
        fill:false
      }]
    },
    options:{
      responsive:true,maintainAspectRatio:false,interaction:{mode:"index",intersect:false},
      animation:{duration:650},
      plugins:{
        legend:{display:false},
        tooltip:{
          backgroundColor:"rgba(11,13,21,.94)",
          borderColor:"rgba(255,255,255,.12)",
          borderWidth:1,
          displayColors:false,
          callbacks:{
            label:(ctx)=>`Rate: ${Number(ctx.raw).toPrecision(7)}`
          }
        }
      },
      scales:{
        x:{display:false,grid:{display:false}},
        y:{display:false,grid:{display:false}}
      }
    }
  });
}

function openCurrencyModal(target){
  state.pickerTarget=target;
  $("currencySearch").value="";
  renderCurrencyList("");
  $("currencyModal").classList.remove("hidden");
  setTimeout(()=>$("currencySearch").focus(),80);
}
function closeCurrencyModal(){
  $("currencyModal").classList.add("hidden");
  state.pickerTarget=null;
}
function renderCurrencyList(query){
  const list=$("currencyList");
  list.innerHTML="";
  const q=query.trim().toLowerCase();

  function addSection(title,items){
    const label=document.createElement("div");label.className="section-label";label.textContent=title;list.appendChild(label);
    items.forEach(c=>{
      const btn=document.createElement("button");
      btn.className="currency-row";
      btn.innerHTML=`<span class="flag">${c.flag}</span><span><strong>${c.code}</strong><small>${c.name}</small></span>`;
      btn.addEventListener("click",()=>{
        if(state.pickerTarget==="from"){
          if(c.code===state.to) state.to=state.from;
          state.from=c.code;
        }else if(state.pickerTarget==="to"){
          if(c.code===state.from) state.from=state.to;
          state.to=c.code;
        }
        savePair();updateCurrencyUI();closeCurrencyModal();fetchCurrentRate();
        if($("chartsView").classList.contains("active")) fetchHistory();
      });
      list.appendChild(btn);
    });
  }

  if(q){
    addSection("Results", currencies.filter(c=>(`${c.code} ${c.name}`).toLowerCase().includes(q)));
  }else{
    addSection("Popular", currencies.filter(c=>popularCodes.includes(c.code)));
    addSection("All currencies", currencies.filter(c=>!popularCodes.includes(c.code)));
  }
}

function initStars(){
  const host=$("stars");
  for(let i=0;i<70;i++){
    const s=document.createElement("span");
    s.className="star";
    s.style.left=`${(i*37)%100}%`;s.style.top=`${(i*61)%100}%`;
    const size=1+(i%3);s.style.width=`${size}px`;s.style.height=`${size}px`;
    s.style.setProperty("--delay",`${(i%9)*.45}s`);
    s.style.setProperty("--duration",`${3+(i%5)}s`);
    host.appendChild(s);
  }
}

document.querySelectorAll(".currency-select").forEach(btn=>btn.addEventListener("click",()=>openCurrencyModal(btn.dataset.picker)));
$("closeModal").addEventListener("click",closeCurrencyModal);
$("currencyModal").addEventListener("mousedown",e=>{if(e.target===$("currencyModal")) closeCurrencyModal();});
$("currencySearch").addEventListener("input",e=>renderCurrencyList(e.target.value));

$("swapBtn").addEventListener("click",()=>{
  [state.from,state.to]=[state.to,state.from];
  savePair();updateCurrencyUI();fetchCurrentRate();
  if($("chartsView").classList.contains("active")) fetchHistory();
});

$("keypad").addEventListener("click",e=>{
  const btn=e.target.closest(".calc-key");
  if(btn) handleCalcKey(btn.textContent.trim());
});

document.querySelectorAll(".tab-btn").forEach(btn=>btn.addEventListener("click",()=>{
  document.querySelectorAll(".tab-btn").forEach(b=>b.classList.remove("active"));
  btn.classList.add("active");
  document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));
  $(btn.dataset.tab==="converter"?"converterView":"chartsView").classList.add("active");
  if(btn.dataset.tab==="charts") fetchHistory();
}));

document.querySelectorAll("[data-range]").forEach(btn=>btn.addEventListener("click",()=>{
  document.querySelectorAll("[data-range]").forEach(b=>b.classList.remove("active"));
  btn.classList.add("active");
  state.range=btn.dataset.range;
  fetchHistory();
}));

initStars();
updateCurrencyUI();
fetchCurrentRate();
