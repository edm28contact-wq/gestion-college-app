"use strict";
(function(root){
 function easterUTC(year){
  const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4,
    f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,
    i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k+7)%7,m=Math.floor((a+11*h+22*l)/451),
    month=Math.floor((h+l-7*m+114)/31),day=((h+l-7*m+114)%31)+1;
  return new Date(Date.UTC(year,month-1,day));
 }
 function dateUTC(year,month,day){return new Date(Date.UTC(year,month-1,day))}
 function plusDays(date,days){const result=new Date(date.getTime());result.setUTCDate(result.getUTCDate()+days);return result}
 function iso(date){return date.toISOString().slice(0,10)}
 function frenchPublicHolidays(year){
  const easter=easterUTC(year),dates=[[1,1],[5,1],[5,8],[7,14],[8,15],[11,1],[11,11],[12,25]].map(([m,d])=>iso(dateUTC(year,m,d)));
  return new Set([...dates,iso(plusDays(easter,1)),iso(plusDays(easter,39)),iso(plusDays(easter,50))]);
 }
 function workingDays(month){
  if(!/^(20\d{2}|2100)-(0[1-9]|1[0-2])$/.test(String(month||"")))return null;
  const [year,number]=month.split("-").map(Number),holidays=frenchPublicHolidays(year);
  const end=new Date(Date.UTC(year,number,0)).getUTCDate();
  let count=0;
  for(let day=1;day<=end;day++){
   const date=dateUTC(year,number,day),weekday=date.getUTCDay();
   if(weekday!==0&&weekday!==6&&!holidays.has(iso(date)))count++;
  }
  return count;
 }
 function decimal(value){return typeof value==="number"&&Number.isFinite(value)?value:null}
 function round(value,places=2){const factor=10**places;return Math.round((value+Number.EPSILON)*factor)/factor}
 function calculate(record,month){
  const days=workingDays(month);
  if(days===null)return null;
  const weekly=decimal(record?.weekly_hours),base=decimal(record?.base_salary_gross),bonus=decimal(record?.bonus_gross);
  const actual=record?.actual_hours==null?null:decimal(record.actual_hours);
  const valid=weekly>0&&weekly<=60&&base!==null&&base>=0&&bonus!==null&&bonus>=0;
  const monthlyHours=valid?weekly*52/12:null;
  return {
   working_days:days, monthly_contract_hours:valid?round(monthlyHours):null,
   theoretical_work_hours:valid?round(days*weekly/5):null,
   actual_hours:actual,actual_confirmed:actual!==null&&actual>=0,
   hourly_gross:valid?round(base/monthlyHours,4):null,
   base_salary_gross:base,bonus_gross:bonus,
   estimated_gross:valid?round(base+bonus):null,
   valid,
  };
 }
 root.CollegeSalaryCalc={easterUTC,frenchPublicHolidays,workingDays,calculate};
})(typeof window!=="undefined"?window:globalThis);
