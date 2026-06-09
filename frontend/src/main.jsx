import ReactDOM from 'react-dom/client'
import 'maplibre-gl/dist/maplibre-gl.css'
import './index.css'
import App from './App.jsx'

// Niente <React.StrictMode>: il doppio-mount in sviluppo crea due istanze MapLibre e rende
// instabile il ciclo di vita della mappa (libreria imperativa). Una sola istanza = render affidabile.
ReactDOM.createRoot(document.getElementById('root')).render(<App />)
