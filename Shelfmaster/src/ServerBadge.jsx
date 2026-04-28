import React from 'react';
import { Link } from 'react-router-dom';
import { getConnection } from './connectionManager';

export default function ServerBadge({ style = {} }) {
  const { ip, port } = getConnection();
  const isRemote = !!ip;
  const label = isRemote ? `${ip}:${port}` : 'This device';

  return (
    <Link
      to="/networksettings"
      title={isRemote ? `Connected to remote server ${ip}:${port}` : 'Using this device as the server'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '4px 10px',
        borderRadius: '999px',
        background: isRemote ? '#ECFDF5' : '#F1F5F9',
        color: isRemote ? '#047857' : '#475569',
        border: `1px solid ${isRemote ? '#A7F3D0' : '#E2E8F0'}`,
        fontSize: '0.75rem',
        fontWeight: 600,
        textDecoration: 'none',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      <span style={{
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        background: isRemote ? '#10B981' : '#94A3B8',
      }} />
      {label}
    </Link>
  );
}
