
import express from 'express';
import bcrypt from 'bcrypt';
import { projects, tasks, users, ObjectId } from '../utils/database.js';

import { connections } from '../utils/webSocketClientHandler.js';

const router = express.Router();

// GET /users
// Get all users
router.get('/', async (req, res) => {
	const allUsers = await users.find().toArray();
	for (const user of allUsers) {
		delete user.password;
		delete user.tokens;
	};
	res.status(200).json(allUsers);
});

// GET /users/:id
// Get a user by id
router.get('/:id', async (req, res) => {
	const id = req.params.id;
	const user = await users.findOne({ _id: ObjectId(id) });
	if (user) {
		delete user.password;
		delete user.tokens;
		res.status(200).json(user);
	} else {
		res.status(404).json({ message: 'User not found' });
	};
});

// GET /users/:id/connections
// Get all connections of user's collaborators
router.get('/:id/connections', async (req, res) => {
	const id = req.params.id;
	const user = await users.findOne({ _id: ObjectId(id) });
	if (!user) {
		res.status(404).json({ message: 'User not found' });
		return;
	};

	// Find tasks and projects that the user is a collaborator on
	const userTasks = [
		...await tasks.find({ collaborators: { $elemMatch: { _id: ObjectId(id), accepted: true } } }).toArray(),
		...await tasks.find({ creatorId: ObjectId(id) }).toArray()
	];
	const userProjects = [
		...await projects.find({ collaborators: { $elemMatch: { _id: ObjectId(id), accepted: true } } }).toArray(),
		...await projects.find({ creatorId: ObjectId(id) }).toArray()
	];
	const allCollaborators = [...userTasks, ...userProjects]
		.map(item => item.collaborators)
		.flat()
		.filter(collaborator => collaborator.accepted)
		.map(collaborator => collaborator._id.toString());

	const collaborators = [...new Set(allCollaborators)].filter(collaborator => collaborator !== id);

	const activeConnectionsId = connections
		.filter(connection => collaborators.includes(connection.authentication._id) && !connection.authentication.serviceWorker)
		.map(connection => connection.authentication._id);

	const activeConnectionsUser = [];
	for (const id of activeConnectionsId) {
		const user = await users.findOne({ _id: ObjectId(id) });
		if (user) {
			delete user.password;
			delete user.tokens;
			activeConnectionsUser.push(user);
		};
	};

	res.status(200).json(activeConnectionsUser);
});

// POST /users
// Sign Up a user
router.post('/', async (req, res) => {
	const { name, email, password } = req.body;

	if (!name || !email || !password) {
		res.status(400).json({ message: 'Please provide all the fields' });
		return;
	};
	
	const user = await users.findOne({ email });

	if (user) {
		res.status(400).json({ message: 'User already exists' });
		return;
	};

	const salt = await bcrypt.genSalt(10);
	const hashedPassword = await bcrypt.hash(password, salt);

	const newUser = {
		name,
		email,
		password: hashedPassword
	};

	const result = await users.insertOne(newUser);

	if (result.insertedId) {
		res.status(200).json({ message: 'User signed up successfully' });
	} else {
		res.status(500).json({ message: 'Failed to sign up user' });
	};
});

// PUT /users
// Sign In a user
router.put('/', async (req, res) => {
	const { email, password } = req.body;

	if (!email || !password) {
		res.status(400).json({ message: 'Please provide all the fields' });
		return;
	};

	const user = await users.findOne({ email });

	if (!user) {
		res.status(400).json({ message: 'User does not exist' });
		return;
	};

	const isMatch = await bcrypt.compare(password, user.password);

	if (isMatch) {
		const token = `${Math.random().toString(36).substring(2, 8)}-${Math.random().toString(36).substring(2, 8)}-${Math.random().toString(36).substring(2, 8)}-${Math.random().toString(36).substring(2, 8)}`;
		const tokens = user.tokens || [];
		tokens.push(token);
		user.tokens = tokens;

		const result = await users.updateOne({ email }, { $set: { tokens } });

		if (result.modifiedCount === 1) {
			res.status(200).json({
				message: 'User signed in successfully',
				authentication: {
					token: token,
					_id: user._id
				}
			});
		} else {
			res.status(500).json({ message: 'Failed to sign in user' });
		};
	} else {
		res.status(400).json({ message: 'Invalid credentials' });
	};
});

// GET /users/:id/invitations
// Get all invitations for a user
router.get('/:id/invitations', async (req, res) => {
	const id = req.params.id;
	const taskInvitations = await tasks.find({ collaborators: { $elemMatch: { _id: ObjectId(id), accepted: false } } }).toArray();
	for (const task of taskInvitations) {
		task.type = 'task';
	};
	const projectInvitations = await projects.find({ collaborators: { $elemMatch: { _id: ObjectId(id), accepted: false } } }).toArray();
	for (const project of projectInvitations) {
		project.type = 'project';
	};

	const invitations = [...taskInvitations, ...projectInvitations];

	const sorted = invitations.sort((a, b) => {
		return new Date(b.dates.crete) - new Date(a.dates.create);
	});
	res.status(200).json(sorted);
});

// POST /users/:id/invitations/:type/:invitationId
// Accept an invitation
router.post('/:id/invitations/:type/:invitationId', async (req, res) => {
	const id = req.params.id;
	const type = req.params.type;
	const invitationId = req.params.invitationId;

	const user = await users.findOne({ _id: ObjectId(id) });
	if (!user) {
		res.status(404).json({ message: 'User not found' });
		return;
	};

	const invitation = await (type === 'task' ? tasks : projects).findOne({ _id: ObjectId(invitationId) });
	if (!invitation) {
		res.status(404).json({ message: 'Invitation not found' });
		return;
	};

	const collaborators = invitation.collaborators || [];
	const index = collaborators.findIndex(collaborator => collaborator._id.toString() === id);
	if (index === -1) {
		res.status(400).json({ message: 'User not invited' });
		return;
	};

	if (collaborators[index].accepted) {
		res.status(400).json({ message: 'User already accepted' });
		return;
	};

	collaborators[index].accepted = true;
	invitation.collaborators = collaborators;

	const result = await (type === 'task' ? tasks : projects).updateOne({ _id: ObjectId(invitationId) }, { $set: { collaborators } });
	if (result.modifiedCount === 1) {
		res.status(200).json({ message: 'Invitation accepted' });

		// Notify serviceWorker collaborators that the user has accepted the invitation
		const message = JSON.stringify({ type: 'NOTIFICATION', message: `${user.name} has accepted the invitation to collaborate on ${invitation.title}` });
		for (const connection of connections) {
			if (invitation.collaborators.find(collaborator => collaborator._id.toString() === connection.authentication._id && collaborator.accepted)) {
				const update = JSON.stringify({ type: 'UPDATE_DATA' });
				connection.ws.send(update);
				connection.ws.send(message);
			};
		};
	} else {
		res.status(500).json({ message: 'Failed to accept invitation' });
	};
});

// DELETE /users/:id/invitations/:type/:invitationId
// Decline an invitation
router.delete('/:id/invitations/:type/:invitationId', async (req, res) => {
	const id = req.params.id;
	const type = req.params.type;
	const invitationId = req.params.invitationId;

	const user = await users.findOne({ _id: ObjectId(id) });
	if (!user) {
		res.status(404).json({ message: 'User not found' });
		return;
	};

	const invitation = await (type === 'task' ? tasks : projects).findOne({ _id: ObjectId(invitationId) });
	if (!invitation) {
		res.status(404).json({ message: 'Invitation not found' });
		return;
	};

	const collaborators = invitation.collaborators || [];
	const index = collaborators.findIndex(collaborator => collaborator._id.toString() === id);
	if (index === -1) {
		res.status(400).json({ message: 'User not invited' });
		return;
	};

	if (collaborators[index].accepted) {
		res.status(400).json({ message: 'User already accepted' });
		return;
	};

	collaborators.splice(index, 1);
	invitation.collaborators = collaborators;

	const result = await (type === 'task' ? tasks : projects).updateOne({ _id: ObjectId(invitationId) }, { $set: { collaborators } });
	if (result.modifiedCount === 1) {
		res.status(200).json({ message: 'Invitation declined' });

		// Notify serviceWorker collaborators that the user has declined the invitation
		const message = JSON.stringify({ type: 'NOTIFICATION', message: `${user.name} has declined the invitation to collaborate on ${invitation.title}` });
		for (const connection of connections) {
			if (invitation.collaborators.find(collaborator => collaborator._id.toString() === connection.authentication._id && collaborator.accepted)) {
				const update = JSON.stringify({ type: 'UPDATE_DATA' });
				connection.ws.send(update);
				connection.ws.send(message);
			};
		};
	} else {
		res.status(500).json({ message: 'Failed to decline invitation' });
	};
});

export default router;