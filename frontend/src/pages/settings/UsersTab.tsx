// Extracted from settings/index.tsx - UsersTab with react-hook-form + zod
import { useState, memo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  getUsers,
  createUser,
  updateUser,
  deleteUser,
  grantServerAccess,
  revokeServerAccess,
  grantModelAccess,
  revokeModelAccess,
  getUserAccess,
  rotateApiKey,
  getServers,
  type UserResponse,
  type CreateUserData,
  type UpdateUserData,
} from '../../api';
import { Modal } from '../../components/Modal';
import { ConfirmationModal } from '../../components/ConfirmationModal';
import { useAuth } from '../../contexts/AuthContext';
import { toastSuccess, toastError } from '../../utils/toast';
import {
  Plus,
  Pencil,
  Trash2,
  Key,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  Users,
  Server,
  Cpu,
  X,
} from 'lucide-react';

const userSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  email: z.string().email('Invalid email format'),
  password: z.string().min(8, 'Password must be at least 8 characters').optional(),
  role: z.enum(['user', 'admin']),
});

type UserFormData = z.infer<typeof userSchema>;

interface UserWithAccess extends UserResponse {
  expanded?: boolean;
  access?: {
    serverAccess: string[];
    modelAccess: Array<{ serverId: string; model: string }>;
  };
  accessLoading?: boolean;
}

const RoleBadge = memo(({ role }: { role: 'admin' | 'user' }) => (
  <span
    className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
      role === 'admin'
        ? 'bg-red-500/20 text-red-400 border border-red-500/30'
        : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
    }`}
  >
    {role}
  </span>
));

RoleBadge.displayName = 'RoleBadge';

const formatDate = (timestamp: number) => {
  if (!timestamp) return 'Never';
  return new Date(timestamp).toLocaleString();
};

export const UsersTab = () => {
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();

  const [users, setUsers] = useState<UserWithAccess[]>([]);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserWithAccess | null>(null);
  const [deletingUser, setDeletingUser] = useState<UserWithAccess | null>(null);
  const [apiKeyModal, setApiKeyModal] = useState<{ userId: string; apiKey: string } | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    setValue,
  } = useForm<UserFormData>({
    resolver: zodResolver(userSchema),
    defaultValues: {
      username: '',
      email: '',
      password: '',
      role: 'user',
    },
  });

  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set());
  const [serverAccessModal, setServerAccessModal] = useState<{
    userId: string;
    mode: 'add' | 'remove';
    serverId?: string;
  } | null>(null);
  const [modelAccessModal, setModelAccessModal] = useState<{
    userId: string;
    serverId: string;
    mode: 'add' | 'remove';
    model?: string;
  } | null>(null);
  const [availableServers, setAvailableServers] = useState<string[]>([]);

  const { data: serversData, isLoading: serversLoading } = useQuery({
    queryKey: ['servers'],
    queryFn: getServers,
  });

  const { isLoading: usersLoading, refetch } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const data = await getUsers();
      setUsers(data.map(u => ({ ...u, expanded: false, accessLoading: false })));
      return data;
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: CreateUserData) => createUser(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toastSuccess('User created successfully');
      setIsAddModalOpen(false);
      reset();
      refetch();
    },
    onError: (error: Error) => {
      toastError(error.message || 'Failed to create user');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateUserData }) => updateUser(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toastSuccess('User updated successfully');
      setEditingUser(null);
      reset();
      refetch();
    },
    onError: (error: Error) => {
      toastError(error.message || 'Failed to update user');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteUser(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toastSuccess('User deleted successfully');
      setDeletingUser(null);
      refetch();
    },
    onError: (error: Error) => {
      toastError(error.message || 'Failed to delete user');
    },
  });

  const rotateApiKeyMutation = useMutation({
    mutationFn: (userId: string) => rotateApiKey(userId),
    onSuccess: (data, userId) => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setApiKeyModal({ userId, apiKey: data.apiKey });
    },
    onError: (error: Error) => {
      toastError(error.message || 'Failed to rotate API key');
    },
  });

  const grantServerAccessMutation = useMutation({
    mutationFn: ({ userId, serverId }: { userId: string; serverId: string }) =>
      grantServerAccess(userId, serverId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toastSuccess('Server access granted');
      setServerAccessModal(null);
      refreshUserAccess(serverAccessModal!.userId);
    },
    onError: (error: Error) => {
      toastError(error.message || 'Failed to grant server access');
    },
  });

  const revokeServerAccessMutation = useMutation({
    mutationFn: ({ userId, serverId }: { userId: string; serverId: string }) =>
      revokeServerAccess(userId, serverId),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toastSuccess('Server access revoked');
      refreshUserAccess(variables.userId);
    },
    onError: (error: Error) => {
      toastError(error.message || 'Failed to revoke server access');
    },
  });

  const [revokeServerAccessModal, setRevokeServerAccessModal] = useState<{
    userId: string;
    serverId: string;
  } | null>(null);

  const grantModelAccessMutation = useMutation({
    mutationFn: ({
      userId,
      serverId,
      model,
    }: {
      userId: string;
      serverId: string;
      model: string;
    }) => grantModelAccess(userId, serverId, model),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toastSuccess('Model access granted');
      setModelAccessModal(null);
      refreshUserAccess(modelAccessModal!.userId);
    },
    onError: (error: Error) => {
      toastError(error.message || 'Failed to grant model access');
    },
  });

  const revokeModelAccessMutation = useMutation({
    mutationFn: ({
      userId,
      serverId,
      model,
    }: {
      userId: string;
      serverId: string;
      model: string;
    }) => revokeModelAccess(userId, serverId, model),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toastSuccess('Model access revoked');
      setModelAccessModal(null);
      refreshUserAccess(revokeModelAccessMutation.variables?.userId || '');
    },
    onError: (error: Error) => {
      toastError(error.message || 'Failed to revoke model access');
    },
  });

  const refreshUserAccess = async (userId: string) => {
    try {
      const access = await getUserAccess(userId);
      setUsers(prev =>
        prev.map(u => (u.id === userId ? { ...u, access, accessLoading: false } : u))
      );
    } catch {
      setUsers(prev => prev.map(u => (u.id === userId ? { ...u, accessLoading: false } : u)));
    }
  };

  const toggleUserExpansion = async (userId: string) => {
    const isCurrentlyExpanded = expandedUsers.has(userId);

    if (isCurrentlyExpanded) {
      const newExpanded = new Set(expandedUsers);
      newExpanded.delete(userId);
      setExpandedUsers(newExpanded);
    } else {
      setExpandedUsers(new Set([...expandedUsers, userId]));

      const user = users.find(u => u.id === userId);
      if (user && !user.access) {
        setUsers(prev => prev.map(u => (u.id === userId ? { ...u, accessLoading: true } : u)));
        await refreshUserAccess(userId);
      }
    }
  };

  const onSubmit = (data: UserFormData) => {
    if (editingUser) {
      const updateData: UpdateUserData = {};
      if (data.username !== editingUser.username) updateData.username = data.username;
      if (data.email !== editingUser.email) updateData.email = data.email;
      if (data.password) updateData.password = data.password;
      if (data.role !== editingUser.role) updateData.role = data.role;

      if (Object.keys(updateData).length === 0) {
        setEditingUser(null);
        return;
      }

      updateMutation.mutate({ id: editingUser.id, data: updateData });
    } else {
      createMutation.mutate({
        username: data.username,
        email: data.email,
        password: data.password || '',
        role: data.role,
      });
    }
  };

  const openEditModal = (user: UserWithAccess) => {
    setValue('username', user.username);
    setValue('email', user.email);
    setValue('password', '');
    setValue('role', user.role);
    setEditingUser(user);
  };

  const copyApiKey = () => {
    if (apiKeyModal?.apiKey) {
      navigator.clipboard.writeText(apiKeyModal.apiKey);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    }
  };

  const handleCloseModal = () => {
    setIsAddModalOpen(false);
    setEditingUser(null);
    reset();
  };

  if (currentUser?.role !== 'admin') {
    navigate('/settings');
    return null;
  }

  if (usersLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin text-blue-500">
          <Users className="w-8 h-8" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-xl font-semibold text-text-base">User Management</h3>
          <p className="text-text-muted text-sm mt-1">Manage users and their access permissions</p>
        </div>
        <button
          onClick={() => {
            reset();
            setIsAddModalOpen(true);
          }}
          className="flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 text-text-base px-4 py-2 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>Add User</span>
        </button>
      </div>

      <div className="bg-surface rounded-xl border border-surface-border overflow-hidden">
        <table className="w-full">
          <thead className="bg-surface-raised/50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                User
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                Role
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                API Key
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                Last Login
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700">
            {users.map(user => (
              <>
                <tr key={user.id} className="hover:bg-surface/30 transition-colors">
                  <td className="px-4 py-4">
                    <div>
                      <div className="font-medium text-text-base">{user.username}</div>
                      <div className="text-sm text-text-subtle">{user.email}</div>
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <RoleBadge role={user.role} />
                  </td>
                  <td className="px-4 py-4">
                    <span className="text-text-muted text-sm">••••••••</span>
                  </td>
                  <td className="px-4 py-4 text-text-muted text-sm">
                    {formatDate(user.updatedAt)}
                  </td>
                  <td className="px-4 py-4">
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-medium ${
                        user.isActive
                          ? 'bg-green-500/20 text-green-400'
                          : 'bg-gray-500/20 text-text-muted'
                      }`}
                    >
                      {user.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => toggleUserExpansion(user.id)}
                        className="p-2 text-text-muted hover:text-text-base hover:bg-surface rounded-lg transition-colors"
                        title="Manage access"
                        aria-label="Manage access"
                      >
                        {expandedUsers.has(user.id) ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                      </button>
                      <button
                        onClick={() => rotateApiKeyMutation.mutate(user.id)}
                        className="p-2 text-text-muted hover:text-yellow-400 hover:bg-yellow-500/10 rounded-lg transition-colors"
                        title="Generate API Key"
                        aria-label="Generate API Key"
                        disabled={rotateApiKeyMutation.isPending}
                      >
                        <Key className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => openEditModal(user)}
                        className="p-2 text-text-muted hover:text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors"
                        title="Edit user"
                        aria-label="Edit user"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setDeletingUser(user)}
                        className="p-2 text-text-muted hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                        title="Delete user"
                        aria-label="Delete user"
                        disabled={user.id === currentUser?.id}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
                {expandedUsers.has(user.id) && (
                  <tr>
                    <td colSpan={6} className="px-4 py-4 bg-surface-raised/30">
                      <div className="space-y-4">
                        {user.accessLoading ? (
                          <div className="flex items-center justify-center py-4">
                            <div className="animate-spin text-text-muted">
                              <Server className="w-5 h-5" />
                            </div>
                          </div>
                        ) : (
                          <>
                            <div>
                              <div className="flex items-center justify-between mb-2">
                                <h4 className="text-sm font-medium text-text-muted flex items-center space-x-2">
                                  <Server className="w-4 h-4" />
                                  <span>Server Access</span>
                                </h4>
                                <button
                                  onClick={() => {
                                    setAvailableServers(
                                      serversData
                                        ?.map(s => s.id)
                                        .filter(id => !user.access?.serverAccess.includes(id)) || []
                                    );
                                    setServerAccessModal({ userId: user.id, mode: 'add' });
                                  }}
                                  className="text-xs text-blue-400 hover:text-blue-300 flex items-center space-x-1"
                                >
                                  <Plus className="w-3 h-3" />
                                  <span>Add Server</span>
                                </button>
                              </div>
                              {user.access?.serverAccess && user.access.serverAccess.length > 0 ? (
                                <div className="flex flex-wrap gap-2">
                                  {user.access.serverAccess.map(serverId => (
                                    <div
                                      key={serverId}
                                      className="flex items-center space-x-2 bg-gray-700/50 px-3 py-1 rounded-lg"
                                    >
                                      <span className="text-sm text-gray-300">{serverId}</span>
                                      <button
                                        onClick={() =>
                                          setRevokeServerAccessModal({ userId: user.id, serverId })
                                        }
                                        className="text-text-muted hover:text-red-400"
                                      >
                                        <X className="w-3 h-3" />
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-sm text-text-subtle">No server access granted</p>
                              )}
                            </div>

                            <div>
                              <div className="flex items-center justify-between mb-2">
                                <h4 className="text-sm font-medium text-text-muted flex items-center space-x-2">
                                  <Cpu className="w-4 h-4" />
                                  <span>Model Access</span>
                                </h4>
                              </div>
                              {user.access?.modelAccess && user.access.modelAccess.length > 0 ? (
                                <div className="space-y-2">
                                  {Object.entries(
                                    user.access.modelAccess.reduce<Record<string, string[]>>(
                                      (acc, { serverId, model }) => {
                                        if (!acc[serverId]) acc[serverId] = [];
                                        acc[serverId].push(model);
                                        return acc;
                                      },
                                      {}
                                    )
                                  ).map(([serverId, models]) => (
                                    <div key={serverId} className="bg-gray-700/30 rounded-lg p-3">
                                      <div className="text-xs text-text-subtle mb-2">
                                        {serverId}
                                      </div>
                                      <div className="flex flex-wrap gap-2">
                                        {models.map(model => (
                                          <div
                                            key={model}
                                            className="flex items-center space-x-2 bg-gray-700/50 px-2 py-1 rounded"
                                          >
                                            <span className="text-sm text-gray-300">{model}</span>
                                            <button
                                              onClick={() =>
                                                setModelAccessModal({
                                                  userId: user.id,
                                                  serverId,
                                                  mode: 'remove',
                                                  model,
                                                })
                                              }
                                              className="text-text-muted hover:text-red-400"
                                            >
                                              <X className="w-3 h-3" />
                                            </button>
                                          </div>
                                        ))}
                                        <button
                                          onClick={() =>
                                            setModelAccessModal({
                                              userId: user.id,
                                              serverId,
                                              mode: 'add',
                                            })
                                          }
                                          className="text-xs text-blue-400 hover:text-blue-300 flex items-center space-x-1 px-2 py-1"
                                        >
                                          <Plus className="w-3 h-3" />
                                          <span>Add Model</span>
                                        </button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-sm text-text-subtle">No model access granted</p>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>

        {users.length === 0 && (
          <div className="text-center py-12 text-text-subtle">
            <Users className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No users found</p>
          </div>
        )}
      </div>

      <Modal
        isOpen={isAddModalOpen || !!editingUser}
        onClose={handleCloseModal}
        title={editingUser ? 'Edit User' : 'Add New User'}
        size="md"
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Username</label>
            <input
              type="text"
              {...register('username')}
              className={`w-full bg-surface-raised border rounded-lg px-4 py-2 text-text-base focus:outline-none focus:ring-2 ${
                errors.username
                  ? 'border-red-500 focus:ring-red-500'
                  : 'border-gray-600 focus:ring-blue-500'
              }`}
            />
            {errors.username && (
              <p className="mt-1 text-sm text-red-400">{errors.username.message}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Email</label>
            <input
              type="email"
              {...register('email')}
              className={`w-full bg-surface-raised border rounded-lg px-4 py-2 text-text-base focus:outline-none focus:ring-2 ${
                errors.email
                  ? 'border-red-500 focus:ring-red-500'
                  : 'border-gray-600 focus:ring-blue-500'
              }`}
            />
            {errors.email && <p className="mt-1 text-sm text-red-400">{errors.email.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              {editingUser ? 'New Password (leave blank to keep current)' : 'Password'}
            </label>
            <input
              type="password"
              {...register('password')}
              className={`w-full bg-surface-raised border rounded-lg px-4 py-2 text-text-base focus:outline-none focus:ring-2 ${
                errors.password
                  ? 'border-red-500 focus:ring-red-500'
                  : 'border-gray-600 focus:ring-blue-500'
              }`}
            />
            {errors.password && (
              <p className="mt-1 text-sm text-red-400">{errors.password.message}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Role</label>
            <select
              {...register('role')}
              className="w-full bg-surface-raised border border-gray-600 rounded-lg px-4 py-2 text-text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </div>

          <div className="flex justify-end space-x-3 pt-4">
            <button
              type="button"
              onClick={handleCloseModal}
              className="px-4 py-2 text-gray-300 hover:text-text-base transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending || updateMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700 text-text-base px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
            >
              {editingUser ? 'Save Changes' : 'Create User'}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmationModal
        isOpen={!!deletingUser}
        onClose={() => setDeletingUser(null)}
        onConfirm={() => deletingUser && deleteMutation.mutate(deletingUser.id)}
        title="Delete User"
        message={`Are you sure you want to delete user "${deletingUser?.username}"? This action cannot be undone.`}
        confirmLabel="Delete"
      />

      <Modal
        isOpen={!!apiKeyModal}
        onClose={() => setApiKeyModal(null)}
        title="API Key Generated"
        size="md"
      >
        <div className="space-y-4">
          <p className="text-text-muted text-sm">
            Store this API key securely. It will not be shown again.
          </p>
          <div className="bg-surface-raised rounded-lg p-4 flex items-center justify-between">
            <code className="text-green-400 font-mono break-all">{apiKeyModal?.apiKey}</code>
            <button
              onClick={copyApiKey}
              className="ml-4 p-2 text-text-muted hover:text-text-base transition-colors flex-shrink-0"
              title="Copy to clipboard"
              aria-label="Copy to clipboard"
            >
              {copiedKey ? (
                <Check className="w-5 h-5 text-green-400" />
              ) : (
                <Copy className="w-5 h-5" />
              )}
            </button>
          </div>
          <div className="flex justify-end">
            <button
              onClick={() => setApiKeyModal(null)}
              className="bg-gray-700 hover:bg-gray-600 text-text-base px-4 py-2 rounded-lg transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={!!serverAccessModal}
        onClose={() => setServerAccessModal(null)}
        title="Add Server Access"
        size="sm"
      >
        <div className="space-y-4">
          {serversLoading ? (
            <p className="text-text-muted">Loading servers...</p>
          ) : availableServers.length > 0 ? (
            <div className="space-y-2">
              {availableServers.map(serverId => (
                <button
                  key={serverId}
                  onClick={() =>
                    grantServerAccessMutation.mutate({
                      userId: serverAccessModal!.userId,
                      serverId,
                    })
                  }
                  className="w-full text-left px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-text-base transition-colors"
                >
                  {serverId}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-text-subtle">All servers already have access</p>
          )}
          <div className="flex justify-end">
            <button
              onClick={() => setServerAccessModal(null)}
              className="px-4 py-2 text-gray-300 hover:text-text-base transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmationModal
        isOpen={!!revokeServerAccessModal}
        onClose={() => setRevokeServerAccessModal(null)}
        onConfirm={() => {
          if (revokeServerAccessModal) {
            revokeServerAccessMutation.mutate({
              userId: revokeServerAccessModal.userId,
              serverId: revokeServerAccessModal.serverId,
            });
          }
        }}
        title="Revoke Server Access"
        message={`Are you sure you want to revoke access to server "${revokeServerAccessModal?.serverId}"?`}
        confirmLabel="Revoke"
      />

      <Modal
        isOpen={!!modelAccessModal && modelAccessModal.mode === 'add'}
        onClose={() => setModelAccessModal(null)}
        title={`Add Model to ${modelAccessModal?.serverId}`}
        size="sm"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Model Name</label>
            <input
              type="text"
              id="modelInput"
              className="w-full bg-surface-raised border border-gray-600 rounded-lg px-4 py-2 text-text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g., llama3:latest"
            />
          </div>
          <div className="flex justify-end space-x-3">
            <button
              onClick={() => setModelAccessModal(null)}
              className="px-4 py-2 text-gray-300 hover:text-text-base transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                const input = document.getElementById('modelInput') as HTMLInputElement;
                if (input?.value && modelAccessModal) {
                  grantModelAccessMutation.mutate({
                    userId: modelAccessModal.userId,
                    serverId: modelAccessModal.serverId,
                    model: input.value,
                  });
                }
              }}
              className="bg-blue-600 hover:bg-blue-700 text-text-base px-4 py-2 rounded-lg transition-colors"
            >
              Add
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmationModal
        isOpen={!!modelAccessModal && modelAccessModal.mode === 'remove'}
        onClose={() => setModelAccessModal(null)}
        onConfirm={() => {
          if (modelAccessModal?.model) {
            revokeModelAccessMutation.mutate({
              userId: modelAccessModal.userId,
              serverId: modelAccessModal.serverId,
              model: modelAccessModal.model,
            });
          }
        }}
        title="Revoke Model Access"
        message={`Are you sure you want to revoke access to model "${modelAccessModal?.model}"?`}
        confirmLabel="Revoke"
      />
    </div>
  );
};
