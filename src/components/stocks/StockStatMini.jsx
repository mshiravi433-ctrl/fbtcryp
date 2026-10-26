function StockStatMini({ label, value, tone }) {
  return (
    <div className="card card-tight" style={{ textAlign: 'center', padding: '10px 6px' }}>
      <div className="faint" style={{ fontSize: 10.5, marginBottom: 3 }}>{label}</div>
      <div className={`mono ${tone === 'up' ? 'up' : tone === 'down' ? 'down' : ''}`} style={{ fontSize: 13, fontWeight: 700 }}>
        {value}
      </div>
    </div>
  );
}

export default StockStatMini;
