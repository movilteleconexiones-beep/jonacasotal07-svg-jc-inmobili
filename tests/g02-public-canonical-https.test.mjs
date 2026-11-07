import { test } from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns/promises';

// Read-only public smoke, no credentials, cookies, form submission, or secrets.
// Both hostnames tested in external GitHub Actions runners, never inferred
// from Railway's internal-domain TLS metadata.
const cases=[
  ['https://www.inmojco.com/','www canonical'],
  ['https://inmojco.com/','apex redirect'],
  ['http://inmojco.com/','apex insecure redirect'],
];
for(const [url,label] of cases) {
  test(`G02 public DNS/HTTPS: ${label}`, async()=>{
    const host=new URL(url).hostname;
    let addr=[];
    try{
      addr=await dns.resolve4(host);
    }catch(e){
      try{ addr=await dns.resolve6(host); }
      catch(e2){ throw new Error(`DNS_FAILURE ${host}: ${e2.code}`); }
    }
    assert.ok(addr.length>0,`No public DNS records for ${host}`);
    const timer=AbortSignal.timeout(12500);
    let response;
    try{
      response=await fetch(url,{method:'GET',redirect:'manual',
        headers:{'User-Agent':'INMOJCO-LaunchReadOnly/1.0','Accept':'text/html'},
        signal:timer});
    }catch(e){throw new Error(`HTTP_FAILURE ${host}: ${e.cause?.code??e.name}`)}
    const location=response.headers.get('location');
    console.log(`${label}: host=${host} status=${response.status} location=${location??'-'}`);
    if(host==='www.inmojco.com'){
      assert.ok([200,301,302,307,308].includes(response.status),'www HTTPS is unhealthy');
      if(response.status!==200) {
        assert.ok(location?.startsWith('https://www.inmojco.com/'),'Unexpected www redirection');
      }
    }else{
      assert.ok([301,308].includes(response.status),'Apex should permanently redirect');
      assert.ok(location?.startsWith('https://www.inmojco.com/'),'Apex redirect must use canonical HTTPS www');
    }
  });
}
