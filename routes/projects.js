
import express from 'express';
import { projects, tasks, users, ObjectId } from '../utils/database.js';

const router = express.Router();

// GET /projects
// Get all projects
router.get('/', async (req, res) => {
	const allProjects = await projects.find().toArray();
	for (const project of allProjects) {
		const collaborators = [];
		for (const collaborator of project.collaborators) {
			const user = await users.findOne({ _id: collaborator._id });
			collaborators.push({ _id: collaborator._id, name: user.name, accepted: collaborator.accepted });
		};
		project.collaborators = collaborators;
	};
	res.status(200).json(allProjects);
});
// GET /projects/:id
// Get a project by id
router.get('/:id', async (req, res) => {
	const project = await projects.findOne({ _id: ObjectId(req.params.id) });
	if (project) {
		const collaborators = [];
		for (const collaborator of project.collaborators) {
			const user = await users.findOne({ _id: collaborator._id });
			collaborators.push({ _id: collaborator._id, name: user.name, accepted: collaborator.accepted });
		};
		project.collaborators = collaborators;
		res.status(200).json(project);
	} else {
		res.status(404).json({ message: 'Project not found' });
	};
});
// GET /projects/user/:userId
// Get all projects of a user
router.get('/user/:userId', async (req, res) => {
	const userId = req.params.userId;

	const user = await users.findOne({ _id: ObjectId(userId) });
	if (!user) {
		res.status(404).json({ message: 'User does not exist' });
		return;
	};

	const userCreatedProjects = await projects.find({ creatorId: ObjectId(userId) }).toArray();
	const userAssignedProjects = await projects.find({ 'collaborators._id': ObjectId(userId) }).toArray();

	const userProjects = [];
	for (const project of userCreatedProjects) {
		userProjects.push(project);
	};
	for (const project of userAssignedProjects) {
		if (!userProjects.find(userProject => userProject._id.toString() === project._id.toString())) {
			if (project.collaborators.find(collaborator => collaborator._id.toString() === userId && collaborator.accepted)) {
				userProjects.push(project);
			};
		};
	};
	
	res.status(200).json(userProjects);
});
// GET /projects/:id/tasks
// Get all tasks of inside a project
router.get('/:id/tasks', async (req, res) => { 
	const id = req.params.id;
	const project = await projects.findOne({ _id: ObjectId(id) });

	if (!project) {
		res.status(404).json({ message: 'Project does not exist' });
		return;
	};

	const projectTasks = await tasks.find({ projectId: ObjectId(id) }).toArray();
	res.status(200).json(projectTasks);
})
// GET /projects/:id/tasks/:userId
// Get all tasks of a user inside a project
router.get('/:id/tasks/:userId', async (req, res) => {
	const id = req.params.id;
	const userId = req.params.userId;
	const project = await projects.findOne({ _id: ObjectId(id) });

	if (!project) {
		res.status(404).json({ message: 'Project does not exist' });
		return;
	};

	const projectTasks = await tasks.find({ projectId: ObjectId(id) }).toArray();
	const userCreatedTasks = projectTasks.filter(task => task.creatorId.toString() === userId);
	const userAssignedTasks = projectTasks.filter(task => task.collaborators.find(collaborator => collaborator._id.toString() === userId));

	const userTasks = [];
	for (const task of userCreatedTasks) {
		userTasks.push(task);
	};
	for (const task of userAssignedTasks) {
		if (!userTasks.find(userTask => userTask._id.toString() === task._id.toString())) {
			userTasks.push(task);
		};
	};

	res.status(200).json(userTasks);
});
// GET /projects/:id/progress
// Get progress of a project
router.get('/:id/progress', async (req, res) => {
	const projectTasks = await tasks.find({ projectId: ObjectId(req.params.id) }).toArray();
	const completedTasks = projectTasks.filter(task => task.status === 'completed');
	const progress = (completedTasks.length / projectTasks.length) * 100;
	res.status(200).json({ progress });
});

// PUT /projects
// Create a new project
router.put('/', async (req, res) => {
	// Input
	/**
	 * {
	 * 	title: title,
	 * 	description: description,
	 * 	dates: {
	 * 		start: start.toDateString(),
	 * 		end: end.toDateString(),
	 * 		create: new Date().toDateString()
	 * 	},
	 *  label: label,
	 * 	creatorId: _id,
	 * 	collaborators: collaborators
	 * }
	 */
	const { title, description, dates, creatorId, label, collaborators } = req.body;

	if (!title || !description || !dates.start || !dates.end || !label) {
		res.status(400).json({ message: 'Please provide all the fields' });
		return;
	};

	if (new Date(dates.start).getTime() > new Date(dates.end).getTime()) {
		res.status(400).json({ message: 'Start date cannot be after end date' });
		return;
	};

	for (const collaborator of collaborators) {
		const user = await users.findOne({ _id: ObjectId(collaborator) });
		if (!user) {
			res.status(404).json({ message: 'User does not exist' });
			return;
		};
	};

	const newProject = {
		title,
		description,
		dates: {
			start: new Date(dates.start),
			end: new Date(dates.end),
			create: new Date()
		},
		label,
		creatorId: ObjectId(creatorId),
		collaborators: [
			{
				_id: ObjectId(creatorId),
				accepted: true
			},
			...collaborators.map(collaborator => {
				return {
					_id: ObjectId(collaborator),
					accepted: false
				};
			})
		],
		completed: false
	};

	const result = await projects.insertOne(newProject);

	if (result.insertedId) {
		res.status(201).json({ message: 'Project created successfully' });
	} else {
		res.status(500).json({ message: 'Something went wrong' });
	};
});
// PUT /projects/:id
// Update a project
router.put('/:id', async (req, res) => {
	const id = req.params.id;
	const project = await projects.findOne({ _id: ObjectId(id) });

	if (!project) {
		res.status(404).json({ message: 'Project does not exist' });
		return;
	};

	if (project.completed) {
		res.status(400).json({ message: 'Project is already completed' });
		return;
	};

	const { title, description, label } = req.body;

	if (!title || !description || !label) {
		res.status(400).json({ message: 'Please provide all the fields' });
		return;
	};

	const result = await projects.updateOne({ _id: ObjectId(id) }, {
		$set: {
			title,
			description,
			label
		}
	});

	if (result.modifiedCount) {
		res.status(200).json({ message: 'Project updated successfully' });
	} else {
		res.status(500).json({ message: 'Something went wrong' });
	};
});
// DELETE /projects/:id
// Delete a project
router.delete('/:id', async (req, res) => {
	const id = req.params.id;
	const project = await projects.findOne({ _id: ObjectId(id) });

	if (!project) {
		res.status(404).json({ message: 'Project does not exist' });
		return;
	};

	if (project.completed) {
		res.status(400).json({ message: 'Project is already completed' });
		return;
	};

	const result = await projects.deleteOne({ _id: ObjectId(id) });

	if (result.deletedCount) {
		res.status(200).json({ message: 'Project deleted successfully' });
	} else {
		res.status(500).json({ message: 'Something went wrong' });
	};
});
// PATCH /projects/:id/:completed
// Update the status of a project
router.patch('/:id/:completed', async (req, res) => {
	const id = req.params.id;
	const completed = req.params.completed;
	const project = await projects.findOne({ _id: ObjectId(id) });

	if (!project) {
		res.status(404).json({ message: 'Project does not exist' });
		return;
	};

	const result = await projects.updateOne({ _id: ObjectId(id) }, {
		$set: {
			completed: completed === 'true'
		}
	});

	if (completed === 'true') {
		await tasks.updateMany({ projectId: ObjectId(id) }, {
			$set: {
				completed: true
			}
		});
	};

	if (result.modifiedCount) {
		res.status(200).json({ message: 'Project updated successfully' });
	} else {
		res.status(500).json({ message: 'Something went wrong' });
	};
});

// PUT /projects/:id/collaborators
// Add a collaborator to a project
router.put('/:id/collaborators', async (req, res) => {
	const id = req.params.id;
	const project = await projects.findOne({ _id: ObjectId(id) });

	if (!project) {
		res.status(404).json({ message: 'Project does not exist' });
		return;
	};

	if (project.completed) {
		res.status(400).json({ message: 'Project is already completed' });
		return;
	};

	if (project.collaborators.find(collaborator => collaborator._id.toString() === req.body.collaboratorId)) {
		res.status(400).json({ message: 'Collaborator already added' });
		return;
	};

	const { collaboratorId } = req.body;

	const collaborator = await users.findOne({ _id: ObjectId(collaboratorId) });

	if (!collaborator) {
		res.status(404).json({ message: 'User does not exist' });
		return;
	};

	const result = await projects.updateOne({ _id: ObjectId(id) }, {
		$push: {
			collaborators: {
				_id: ObjectId(collaboratorId),
				accepted: false
			}
		}
	});

	if (result.modifiedCount) {
		
		res.status(200).json({ message: 'Collaborator added successfully', collaborator: { _id: ObjectId(collaboratorId), name: collaborator.name, accepted: false } });
	} else {
		res.status(500).json({ message: 'Something went wrong' });
	};
});
router.delete('/:id/collaborators/:collaboratorId', async (req, res) => {
	const id = req.params.id;
	const collaboratorId = req.params.collaboratorId;
	const project = await projects.findOne({ _id: ObjectId(id) });

	if (!project) {
		res.status(404).json({ message: 'Project does not exist' });
		return;
	};

	if (project.completed) {
		res.status(400).json({ message: 'Project is already completed' });
		return;
	};

	const result = await projects.updateOne({ _id: ObjectId(id) }, {
		$pull: {
			collaborators: { _id: ObjectId(collaboratorId) }
		}
	});

	// Delete tasks of the collaborator
	await tasks.deleteMany({ projectId: ObjectId(id), creatorId: ObjectId(collaboratorId) });
	await tasks.updateMany({ projectId: ObjectId(id) }, {
		$pull: {
			collaborators: { _id: ObjectId(collaboratorId) }
		}
	});

	if (result.modifiedCount) {
		res.status(200).json({ message: 'Collaborator removed successfully' });
	} else {
		res.status(500).json({ message: 'Something went wrong' });
	};
});

// PATCH /projects/:id/dates/:type
// Update dates of a project
router.patch('/:id/dates/:type', async (req, res) => {
	const id = req.params.id;
	const type = req.params.type;
	const project = await projects.findOne({ _id: ObjectId(id) });

	if (!project) {
		res.status(404).json({ message: 'Project does not exist' });
		return;
	};

	if (project.completed) {
		res.status(400).json({ message: 'Project is already completed' });
		return;
	};

	const { date } = req.body;

	if (!date) {
		res.status(400).json({ message: 'Please provide a date' });
		return;
	};

	if (type !== 'start' && type !== 'end') {
		res.status(400).json({ message: 'Invalid date type' });
		return;
	};

	const projectTasks = await tasks.find({ projectId: ObjectId(id) }).toArray();
	for (const task of projectTasks) {
		// Project cannot start after a task has started and end before a task has ended
		if (type === 'start' && new Date(date).getTime() > new Date(task.dates.start).getTime()) {
			res.status(400).json({ message: 'Project cannot start after a task has started' });
			return;
		};
		if (type === 'end' && new Date(date).getTime() < new Date(task.dates.end).getTime()) {
			res.status(400).json({ message: 'Project cannot end before a task has ended' });
			return;
		};
	};

	const result = await projects.updateOne({ _id: ObjectId(id) }, {
		$set: {
			[`dates.${type}`]: new Date(date)
		}
	});

	if (result.modifiedCount) {
		res.status(200).json({ message: 'Date updated successfully', date });
	} else {
		res.status(500).json({ message: 'Something went wrong' });
	};
});

export default router;