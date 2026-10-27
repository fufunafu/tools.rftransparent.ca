import json, os, pathlib, subprocess, time
base=pathlib.Path('/Library/Application Support/RFToolsSecurity')
log=pathlib.Path('/var/log/rf-amazon-security')
state_path=base/'health.json'
try: prior=json.loads(state_path.read_text())
except (OSError,ValueError): prior={}
files=sorted(log.glob('eve-*.json')); event_file=files[-1] if files else None
state={'checkedAt':time.time(),'file':str(event_file),'offset':0,'alerts':prior.get('alerts',0),'testAlerts':prior.get('testAlerts',0),'lastAlertAt':prior.get('lastAlertAt'),'lastPacketCount':prior.get('lastPacketCount')}
r=subprocess.run(['/bin/launchctl','print','system/ca.rftransparent.amazon-ids'],capture_output=True,text=True)
state['running']=r.returncode==0 and '\tstate = running' in r.stdout
state['interface']=subprocess.run(['/sbin/route','-n','get','default'],capture_output=True,text=True).stdout.split('interface:')[-1].splitlines()[0].strip()
state['monitoringExpectedInterface']=state['interface']=='en0'
if event_file:
    with event_file.open() as f:
        size=event_file.stat().st_size
        offset=prior.get('offset',0) if prior.get('file')==str(event_file) else 0
        if offset>size: offset=0
        f.seek(offset)
        for line in f:
            try: e=json.loads(line)
            except ValueError: continue
            if e.get('event_type')=='stats': state['lastPacketCount']=e.get('stats',{}).get('decoder',{}).get('pkts')
            if e.get('event_type')!='alert': continue
            a=e.get('alert',{})
            if a.get('signature_id')==9900001: state['testAlerts']+=1
            elif a.get('severity',9)<=2:
                state['alerts']+=1; state['lastAlertAt']=e.get('timestamp')
        state['offset']=f.tell()
    state['lastEventAgeSeconds']=time.time()-event_file.stat().st_mtime
try: state['rulesAgeHours']=(time.time()-(base/'rules-updated').stat().st_mtime)/3600
except OSError: state['rulesAgeHours']=999
state['healthy']=state['running'] and state['monitoringExpectedInterface'] and state.get('lastEventAgeSeconds',999)<180 and state['rulesAgeHours']<72
staged=base/'health.tmp'; staged.write_text(json.dumps(state)); os.chmod(staged,0o644); staged.replace(state_path)
