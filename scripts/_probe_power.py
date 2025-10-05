import requests, json
lat=12.91; lon=74.85
url='https://power.larc.nasa.gov/api/temporal/daily/point'
params={'parameters':'T2M,PRECTOT,WS2M','community':'RE','longitude':lon,'latitude':lat,'start':'20200101','end':'20241231','format':'JSON'}
print('Requesting:', url)
r=requests.get(url,params=params,timeout=30)
print('HTTP', r.status_code)
j=r.json()
print('top keys:', list(j.keys()))
if isinstance(j,dict):
    if 'properties' in j and 'parameter' in j['properties']:
        print('found properties.parameter keys:', list(j['properties']['parameter'].keys())[:50])
    if 'parameters' in j:
        print('found parameters keys:', list(j['parameters'].keys())[:50])
    if 'parameter' in j:
        print('found parameter keys:', list(j['parameter'].keys())[:50])
print('\nSample snippet for properties.parameter if present:')
try:
    block=j.get('properties',{}).get('parameter',{})
    for k in list(block)[:10]:
        print(k, '-> type:', type(block[k]))
        if isinstance(block[k], dict):
            keys=list(block[k].keys())[:5]
            print('  sample keys:', keys)
except Exception as e:
    print('err',e)
