import React from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlowProvider } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import '@fontsource-variable/dm-sans';
import '@fontsource/kalam/400.css';
import '@fontsource/kalam/700.css';
import App from './App.jsx';
import { transferLocalBoard } from './localBoardTransfer.js';
import './styles.css';

void transferLocalBoard().then(() => {
  createRoot(document.getElementById('root')).render(
    <ReactFlowProvider>
      <App />
    </ReactFlowProvider>
  );
});
