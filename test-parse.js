// Quick test script to verify MIDI parsing works
const fs = require('fs');
const path = require('path');

// Load the MIDI parser
const parserCode = fs.readFileSync(path.join(__dirname, 'js/midi-parser.js'), 'utf8');
const vm = require('vm');
vm.runInThisContext(parserCode);

const midiFile = path.join(__dirname, '../testmids/Again_(Your_Lie_in_April).mid');
const buffer = fs.readFileSync(midiFile);
const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

try {
  const parser = new MidiParser();
  const data = parser.parse(arrayBuffer);
  
  console.log('=== MIDI Parse Results ===');
  console.log('Format:', data.header.format);
  console.log('Tracks:', data.header.numTracks);
  console.log('Ticks/Beat:', data.header.ticksPerBeat);
  console.log('Total Notes:', data.notes.length);
  console.log('Duration:', data.duration.toFixed(1), 'seconds');
  console.log('Measures:', data.measures.length);
  console.log('Tempo Map:', JSON.stringify(data.tempoMap.slice(0, 5)));
  console.log('Time Signatures:', JSON.stringify(data.timeSignatures));
  
  // Hand detection
  const rightNotes = data.notes.filter(n => n.hand === 'right');
  const leftNotes = data.notes.filter(n => n.hand === 'left');
  console.log('Right Hand Notes:', rightNotes.length);
  console.log('Left Hand Notes:', leftNotes.length);
  
  // Track info
  data.tracks.forEach((t, i) => {
    const trackNotes = data.notes.filter(n => n.track === i);
    const noteEvents = t.events.filter(e => e.type === 'noteOn');
    console.log(`Track ${i}: "${t.name || '(unnamed)'}" - ${noteEvents.length} noteOn events, ${trackNotes.length} notes`);
  });
  
  // Note range
  const allNoteNums = data.notes.map(n => n.noteNumber);
  console.log('Note range:', Math.min(...allNoteNums), '-', Math.max(...allNoteNums));
  console.log('Note range names:', midiToNoteName(Math.min(...allNoteNums)), '-', midiToNoteName(Math.max(...allNoteNums)));
  
  // First few notes
  console.log('\nFirst 10 notes:');
  data.notes.slice(0, 10).forEach(n => {
    console.log(`  ${midiToNoteName(n.noteNumber)} (${n.noteNumber}) t=${n.startTime.toFixed(3)}s dur=${n.duration.toFixed(3)}s hand=${n.hand} track=${n.track}`);
  });
  
  // First few measures
  console.log('\nFirst 5 measures:');
  data.measures.slice(0, 5).forEach(m => {
    console.log(`  M${m.number}: ${m.startTime.toFixed(3)}s - ${m.endTime.toFixed(3)}s (${m.numerator}/${m.denominator})`);
  });
  
  console.log('\n=== PARSE SUCCESS ===');
} catch (err) {
  console.error('PARSE FAILED:', err.message);
  console.error(err.stack);
}
