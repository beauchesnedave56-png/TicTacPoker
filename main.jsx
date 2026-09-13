import React from 'react'
import ReactDOM from 'react-dom/client'
import TicATacPoker from './TicATacPoker1v1.jsx'
import './index.css'

// Filet de sécurité : si un bug JS survient pendant le rendu, on affiche un
// message clair (avec bouton pour recharger) au lieu d'un écran blanc muet.
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  componentDidCatch(error, info) {
    console.error('Tic-A-Tac Poker crash:', error, info)
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: '100vh', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 16,
          fontFamily: 'Georgia, serif', color: '#FFD700',
          background: 'radial-gradient(ellipse at 50% 0%,#1B5E3A 0%,#0F3D22 40%,#061A0F 100%)',
          padding: 20, textAlign: 'center',
        }}>
          <div style={{ fontSize: 22 }}>⚠️ Something went wrong</div>
          <div style={{ color: '#D1D5DB', fontSize: 13, maxWidth: 420 }}>
            {this.state.error.message}
          </div>
          <button onClick={() => window.location.reload()} style={{
            background: 'linear-gradient(135deg,#FFD700,#FF8C00)', border: 'none',
            borderRadius: 10, padding: '10px 24px', color: '#1A1A2E',
            fontWeight: 'bold', fontSize: 14, cursor: 'pointer', fontFamily: 'Georgia,serif',
          }}>↺ Reload</button>
        </div>
      )
    }
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <TicATacPoker />
    </ErrorBoundary>
  </React.StrictMode>,
)
