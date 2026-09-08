"""Original ChessBlox score. Deterministic synthesis; no samples or third-party recordings.
32 bars, 100 BPM. Warm electric keys, syncopated bass, muted plucks and brushed drums.
Rebuild with NumPy, then ffmpeg -i INPUT.wav -c:a aac -b:a 160k -movflags +faststart OUTPUT.m4a.
"""
from pathlib import Path
import json
import wave
import numpy as np
def filter_audio(signal, low=0, high=22050):
    freq=np.fft.rfftfreq(len(signal),1/44100)
    gain=1/(1+(freq/max(high,1))**4)
    if low: gain*=1/(1+(low/np.maximum(freq,.01))**4)
    if signal.ndim==2: gain=gain[:,None]
    return np.fft.irfft(np.fft.rfft(signal,axis=0)*gain,n=len(signal),axis=0)

SR = 44100
BPM = 100
BEAT = 60 / BPM
LENGTH = 32 * 4 * BEAT
N = round(SR * LENGTH)
rng = np.random.default_rng(9082026)
bus = {name: np.zeros((N, 2), np.float64) for name in ('keys', 'bass', 'drums', 'lead')}

def add(track, signal, seconds, gain=1., pan=0.):
    signal = np.asarray(signal)
    stereo = signal[:, None] * np.array([np.sqrt((1-pan)/2), np.sqrt((1+pan)/2)])[None, :] * gain
    start = round(seconds * SR) % N
    first = min(len(signal), N-start)
    bus[track][start:start+first] += stereo[:first]
    if first < len(signal): bus[track][:len(signal)-first] += stereo[first:]

def hz(m): return 440 * 2**((m-69)/12)
def time(d): return np.arange(round(SR*d))/SR

def keys(m, d):
    t=time(d); f=hz(m)
    attack=1-np.exp(-t*180)
    body=np.sin(2*np.pi*f*t + .52*np.sin(2*np.pi*f*2*t)*np.exp(-t*5))
    bell=.20*np.sin(2*np.pi*f*3*t)*np.exp(-t*7)
    tremolo=.97+.03*np.sin(2*np.pi*4.2*t)
    return (body+bell)*attack*np.exp(-t*2.05)*tremolo*np.minimum(1,(d-t)*12)

def pad(m, d):
    t=time(d); f=hz(m)
    env=np.minimum(1,t/.24)*np.minimum(1,(d-t)/.55)
    return (np.sin(2*np.pi*f*t)+.3*np.sin(2*np.pi*f*1.002*t)+.1*np.sin(2*np.pi*f*2*t))*env*.13

def pluck(m, d=.9):
    t=time(d); f=hz(m)
    return (np.sin(2*np.pi*f*t+1.2*np.sin(2*np.pi*f*2*t)*np.exp(-t*15))+.12*np.sin(2*np.pi*f*3*t))*np.exp(-t*6)*(1-np.exp(-t*350))*np.minimum(1,(d-t)*20)

def bass(m,d=.36):
    t=time(d);f=hz(m)
    return (np.sin(2*np.pi*f*t)+.25*np.sin(2*np.pi*2*f*t)+.065*np.sin(2*np.pi*3*f*t))*(1-np.exp(-t*100))*np.exp(-t*2)*np.minimum(1,(d-t)/.08)

def kick():
    t=time(.36); phase=2*np.pi*(47*t+54*.035*(1-np.exp(-t/.035)))
    return np.sin(phase)*np.exp(-t*12)*(1-np.exp(-t*550))

def hat(opened=False):
    t=time(.17 if opened else .065); noise=rng.normal(0,1,len(t))
    filtered=filter_audio(noise,low=6500)
    return filtered*np.exp(-t*(24 if opened else 65))*np.minimum(1,t*2000)

def rim():
    t=time(.14)
    wood=(np.sin(2*np.pi*920*t)+.4*np.sin(2*np.pi*1470*t))*np.exp(-t*60)
    noise=filter_audio(rng.normal(0,1,len(t)),low=1400,high=6000)
    return wood*.6+noise*.3*np.exp(-t*40)

# Dmaj9 / Bm9 / Gmaj9 / A13: close, soft voicings with an original top line.
chords=[[62,66,69,73,76],[59,62,66,69,73],[55,59,62,66,69],[57,61,64,66,71]]
roots=[38,35,31,33]
motifs=[[(0,78),(.75,76),(1.5,73),(2.75,76),(3.5,81)],[(.5,78),(1.25,76),(2.5,73),(3.25,69)],[(0,74),(1,78),(1.75,76),(2.5,74),(3.5,71)],[(.5,73),(1.5,71),(2.25,69),(3.25,73)]]
for bar in range(32):
    chord=chords[bar%4];root=roots[bar%4];start=bar*4*BEAT
    # Four phrases: sparse opening, main groove, airy break, then lifted reprise.
    phrase=bar//8; sparse=phrase==2 and bar%8<4
    for i,note in enumerate(chord):
        add('keys',pad(note-12,4*BEAT+.55),start,.10,(-.65+i*.32))
        for off,vel in [(0,.09),(1.75,.065),(3,.072)]:
            add('keys',keys(note,1.7),start+off*BEAT+i*.011,vel,-.4+i*.2)
    for off,step,dur,gain in [(0,0,.65,.24),(1.5,0,.24,.19),(2.5,12,.23,.14),(3.25,7,.28,.18)]:
        add('bass',bass(root+step,dur),start+off*BEAT,gain)
    if not sparse:
        for off,vel in [(0,.31),(1.75,.20),(2.5,.25)]: add('drums',kick(),start+off*BEAT,vel)
        for off in [1,3]: add('drums',rim(),start+off*BEAT,.16,-.13)
        for j in range(8):
            off=j*.5+(.04 if j%2 else 0)
            add('drums',hat(opened=j==7 and bar%4==3),start+off*BEAT,.037 if j%2 else .022,.4)
        if bar%8==7:
            for j in range(3): add('drums',rim(),start+(3.5+j*.16)*BEAT,.06-.012*j,-.3+j*.3)
    else:
        for off in [0,2]: add('drums',kick(),start+off*BEAT,.18)
    if phrase != 0 or bar >= 4:
        for off,note in motifs[bar%4]:
            if sparse and off>2: continue
            add('lead',pluck(note + (12 if phrase==3 and bar%8>=4 else 0)),start+off*BEAT,.062 if phrase==3 else .051,(-.18 if bar%2 else .18))
        if bar%4==3: add('lead',pluck(85,1.3),start+3.75*BEAT,.022,.55)

# Stereo echoes and a short diffuse room, wrapped into the start for a continuous loop.
for name in ('keys','lead'):
    dry=bus[name].copy()
    for delay,gain in [(.3,.16),(.45,.08),(.6,.06)]: bus[name]+=np.roll(dry[:,::-1],round(delay*SR),axis=0)*gain
    for i in range(10):
        delay=.041+i*.032
        bus[name]+=np.roll(dry,round(delay*SR),axis=0)*(.028*(1-i/12))
# Gentle sidechain makes space for the downbeat without obvious pumping.
t=np.arange(N)/SR
pulse=1-.13*np.exp(-np.mod(t,BEAT)/.10)
bus['keys']*=pulse[:,None]
mix=sum(bus.values())
mix=filter_audio(mix,low=32)
mix=np.tanh(mix*1.1)
mix*=.79/np.max(np.abs(mix))
out=Path('artifacts/meme-court-implementation');out.mkdir(parents=True,exist_ok=True)
with wave.open(str(out/'cloud-nine-master.wav'),'wb') as f:
    f.setnchannels(2);f.setsampwidth(2);f.setframerate(SR);f.writeframes((mix*32767).astype('<i2').tobytes())
metadata={'title':'Cloud Nine','composition':'Original procedural composition created for ChessBlox','bpm':BPM,'bars':32,'duration_seconds':LENGTH,'sample_rate':SR,'peak_dbfs':round(20*np.log10(np.max(np.abs(mix))),2),'rms_dbfs':round(20*np.log10(np.sqrt(np.mean(mix**2))),2),'source_recordings':[]}
(out/'music-provenance.json').write_text(json.dumps(metadata,indent=2)+'\n')
print(json.dumps(metadata))
