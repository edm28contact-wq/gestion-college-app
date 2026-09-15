// Routage temporaire de compatibilite vers le backend EDM actif.
// Aucune cle privee n'est exposee ici.
(()=>{
  const OLD='https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/accounting-api';
  const ACTIVE='https://ojjbnwpkfvzjfukgqddz.supabase.co/functions/v1/accounting-api';
  const baseFetch=window.fetch.bind(window);
  window.fetch=(input,init)=>{
    try{
      const raw=typeof input==='string'?input:input?.url;
      if(raw&&raw.startsWith(OLD)){
        const next=ACTIVE+raw.slice(OLD.length);
        if(typeof input==='string')return baseFetch(next,init);
        return baseFetch(new Request(next,input),init);
      }
    }catch{}
    return baseFetch(input,init);
  };
})();
