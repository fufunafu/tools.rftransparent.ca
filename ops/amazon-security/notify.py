import json,pathlib,subprocess,time
health=pathlib.Path('/Library/Application Support/RFToolsSecurity/health.json')
cache=pathlib.Path.home()/'Library/Caches/ca.rftransparent.amazon-security.json'
try: current=json.loads(health.read_text())
except (OSError,ValueError): current={'healthy':False,'checkedAt':0}
try: previous=json.loads(cache.read_text())
except (OSError,ValueError): previous={}
message=None
if not current.get('healthy') or time.time()-current.get('checkedAt',0)>180:
    if time.time()-previous.get('lastWarningAt',0)>3600:
        message='Network monitoring needs attention. Pause Amazon work and check the security health report.'
        current['lastWarningAt']=time.time()
    else: current['lastWarningAt']=previous.get('lastWarningAt',0)
elif current.get('alerts',0)>previous.get('alerts',0): message='A network security alert needs review. Open the local security log and follow the incident response plan.'
elif current.get('testAlerts',0)>previous.get('testAlerts',0): message='The harmless network detection test passed. Intrusion detection is working.'
if message:
    subprocess.run(['/usr/bin/osascript','-e','display notification '+json.dumps(message)+' with title "RF Tools network security"'])
cache.parent.mkdir(parents=True,exist_ok=True); cache.write_text(json.dumps(current))
