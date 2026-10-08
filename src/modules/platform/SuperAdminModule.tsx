import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

export default function SuperAdminModule() {
  const [organizations, setOrganizations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    slug: '',
    license_type: 'monthly',
    country_id: 'CO',
    currency_code: 'COP',
    tax_id_type: 'NIT',
    tax_id_number: '',
    expires_at: ''
  });

  useEffect(() => {
    fetchOrganizations();
  }, []);

  async function fetchOrganizations() {
    setLoading(true);
    const { data, error } = await supabase
      .from('organizations')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error) setOrganizations(data || []);
    setLoading(false);
  }

  async function handleCreateOrganization(e: React.FormEvent) {
    e.preventDefault();
    
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .insert([{
        name: formData.name,
        slug: formData.name.toLowerCase().replace(/\s+/g, '-'),
        license_type: formData.license_type,
        country_id: formData.country_id,
        currency_code: formData.currency_code,
        tax_id_type: formData.tax_id_type,
        tax_id_number: formData.tax_id_number,
        expires_at: formData.license_type === 'lifetime' ? null : formData.expires_at || null,
        status: 'active'
      }])
      .select()
      .single();

    if (orgError) {
      alert('Error al crear inmobiliaria: ' + orgError.message);
      return;
    }

    alert(`Inmobiliaria "${org.name}" creada con éxito.`);
    setShowModal(false);
    setFormData({
      name: '', slug: '', license_type: 'monthly',
      country_id: 'CO', currency_code: 'COP',
      tax_id_type: 'NIT', tax_id_number: '', expires_at: ''
    });
    fetchOrganizations();
  }

  async function toggleStatus(id: string, currentStatus: string) {
    const newStatus = currentStatus === 'active' ? 'suspended' : 'active';
    const { error } = await supabase
      .from('organizations')
      .update({ status: newStatus })
      .eq('id', id);

    if (!error) fetchOrganizations();
  }

  return (
    <div style={{ padding: '24px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 style={{ margin: 0 }}>Panel Súper Administrador</h1>
          <p style={{ color: '#666', margin: '4px 0 0' }}>Gestión de licencias e inmobiliarias en Latinoamérica</p>
        </div>
        <button 
          onClick={() => setShowModal(true)}
          style={{ background: '#10B981', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>
          + Nueva Inmobiliaria
        </button>
      </div>

      {loading ? (
        <p>Cargando empresas...</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #E5E7EB' }}>
          <thead>
            <tr style={{ background: '#F9FAFB', textAlign: 'left', borderBottom: '1px solid #E5E7EB' }}>
              <th style={{ padding: '12px' }}>Inmobiliaria</th>
              <th style={{ padding: '12px' }}>País / Identificación</th>
              <th style={{ padding: '12px' }}>Tipo Licencia</th>
              <th style={{ padding: '12px' }}>Vencimiento</th>
              <th style={{ padding: '12px' }}>Estado</th>
              <th style={{ padding: '12px' }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {organizations.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: '20px', textAlign: 'center' }}>No hay inmobiliarias registradas aún.</td></tr>
            ) : (
              organizations.map(org => (
                <tr key={org.id} style={{ borderBottom: '1px solid #E5E7EB' }}>
                  <td style={{ padding: '12px', fontWeight: 'bold' }}>{org.name}</td>
                  <td style={{ padding: '12px' }}>{org.country_id} - {org.tax_id_type}: {org.tax_id_number || 'N/A'}</td>
                  <td style={{ padding: '12px' }}>
                    <span style={{ 
                      background: org.license_type === 'lifetime' ? '#EEF2FF' : '#FEF3C7',
                      color: org.license_type === 'lifetime' ? '#4F46E5' : '#D97706',
                      padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 'bold'
                    }}>
                      {org.license_type === 'lifetime' ? 'VITALICIA' : 'MENSUAL'}
                    </span>
                  </td>
                  <td style={{ padding: '12px' }}>
                    {org.license_type === 'lifetime' ? 'Sin Expiración' : (org.expires_at ? new Date(org.expires_at).toLocaleDateString() : 'Por definir')}
                  </td>
                  <td style={{ padding: '12px' }}>
                    <span style={{ color: org.status === 'active' ? '#10B981' : '#EF4444', fontWeight: 'bold' }}>
                      {org.status === 'active' ? '● Activa' : '● Suspendida'}
                    </span>
                  </td>
                  <td style={{ padding: '12px' }}>
                    <button 
                      onClick={() => toggleStatus(org.id, org.status)}
                      style={{ 
                        background: org.status === 'active' ? '#EF4444' : '#10B981', 
                        color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer' 
                      }}>
                      {org.status === 'active' ? 'Suspender' : 'Activar'}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}

      {/* MODAL CREAR INMOBILIARIA */}
      {showModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', padding: '24px', borderRadius: '12px', width: '480px', maxWidth: '90%' }}>
            <h2>Registrar Nueva Inmobiliaria</h2>
            <form onSubmit={handleCreateOrganization}>
              <div style={{ marginBottom: '12px' }}>
                <label>Nombre de la Inmobiliaria</label>
                <input required type="text" style={{ width: '100%', padding: '8px', marginTop: '4px' }} 
                  value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
              </div>
              
              <div style={{ marginBottom: '12px' }}>
                <label>Tipo de Licencia</label>
                <select style={{ width: '100%', padding: '8px', marginTop: '4px' }}
                  value={formData.license_type} onChange={e => setFormData({...formData, license_type: e.target.value})}>
                  <option value="monthly">Suscripción Mensual</option>
                  <option value="lifetime">Licencia Vitalicia</option>
                </select>
              </div>

              {formData.license_type === 'monthly' && (
                <div style={{ marginBottom: '12px' }}>
                  <label>Fecha de Vencimiento de Pago</label>
                  <input type="date" style={{ width: '100%', padding: '8px', marginTop: '4px' }}
                    value={formData.expires_at} onChange={e => setFormData({...formData, expires_at: e.target.value})} />
                </div>
              )}

              <div style={{ marginBottom: '12px' }}>
                <label>País</label>
                <select style={{ width: '100%', padding: '8px', marginTop: '4px' }}
                  value={formData.country_id} onChange={e => setFormData({...formData, country_id: e.target.value, currency_code: e.target.value === 'CO' ? 'COP' : 'USD'})}>
                  <option value="CO">Colombia (COP)</option>
                  <option value="MX">México (MXN)</option>
                  <option value="PE">Perú (PEN)</option>
                  <option value="EC">Ecuador (USD)</option>
                </select>
              </div>

              <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                <div style={{ flex: 1 }}>
                  <label>Doc. Fiscal</label>
                  <select style={{ width: '100%', padding: '8px', marginTop: '4px' }}
                    value={formData.tax_id_type} onChange={e => setFormData({...formData, tax_id_type: e.target.value})}>
                    <option value="NIT">NIT</option>
                    <option value="RFC">RFC</option>
                    <option value="RUC">RUC</option>
                    <option value="RUT">RUT</option>
                  </select>
                </div>
                <div style={{ flex: 2 }}>
                  <label>Número Identificación</label>
                  <input type="text" style={{ width: '100%', padding: '8px', marginTop: '4px' }}
                    value={formData.tax_id_number} onChange={e => setFormData({...formData, tax_id_number: e.target.value})} />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '20px' }}>
                <button type="button" onClick={() => setShowModal(false)} style={{ padding: '8px 16px', borderRadius: '6px' }}>Cancelar</button>
                <button type="submit" style={{ background: '#10B981', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '6px' }}>Guardar Inmobiliaria</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}