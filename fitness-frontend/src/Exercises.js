import React, { useState, useEffect } from 'react';
import axios from 'axios';

export default function Exercises() {
  // Local form state controls the exercise entry fields before they are persisted.
  const [exercises, setExercises] = useState([]);
  const [name, setName] = useState('');
  const [reps, setReps] = useState('');
  const [sets, setSets] = useState('');

  useEffect(() => {
    // Load existing workout movements when the exercise tab first opens.
    axios.get('http://localhost:5000/exercises')
      .then(res => setExercises(res.data))
      .catch(err => console.log(err));
  }, []);

  const addExercise = () => {
    // Persist a new exercise and append the returned database row to the list.
    if (!name || !reps || !sets) return alert('Fill all fields');
    axios.post('http://localhost:5000/exercises', { name, reps, sets })
      .then(res => setExercises(prev => [...prev, res.data]))
      .catch(err => console.log(err));
    setName('');
    setReps('');
    setSets('');
  };

  const deleteExercise = (id) => {
    // Delete on the backend first so the UI does not hide a row that failed to persist.
    axios.delete(`http://localhost:5000/exercises/${id}`)
      .then(() => setExercises(exercises.filter(ex => ex.id !== id)))
      .catch(err => console.log(err));
  };

  return (
    <div>
      <h2 className="section-title">Exercises</h2>

      <div className="form-vertical">
        <input className="input" placeholder="Exercise Name" value={name} onChange={e => setName(e.target.value)} />
        <input className="input" placeholder="Reps" value={reps} onChange={e => setReps(e.target.value)} />
        <input className="input" placeholder="Sets" value={sets} onChange={e => setSets(e.target.value)} />
        <div>
          <button className="btn btn-scan" onClick={addExercise}>Add Exercise</button>
        </div>
      </div>

      <ul className="list-space">
        {exercises.map(ex => (
          <li key={ex.id} className="entry-item">
            <span>{ex.name}: {ex.reps} reps x {ex.sets} sets</span>
            <button className="btn btn-danger btn-small" onClick={() => deleteExercise(ex.id)}>Delete</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
