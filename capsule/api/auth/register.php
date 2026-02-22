<?php
header('Content-Type: application/json');
require_once '../config/database.php';

$data = json_decode(file_get_contents('php://input'), true);
$username = $data['username'] ?? '';
$email = $data['email'] ?? '';
$password = $data['password'] ?? '';

if (!$username || !$email || !$password) {
    http_response_code(400);
    echo json_encode(['error' => 'All fields required']);
    exit;
}

// Check if user exists
$stmt = $pdo->prepare("SELECT id FROM users WHERE email = ? OR username = ?");
$stmt->execute([$email, $username]);
if ($stmt->fetch()) {
    http_response_code(400);
    echo json_encode(['error' => 'User already exists']);
    exit;
}

$hashed = password_hash($password, PASSWORD_DEFAULT);

$stmt = $pdo->prepare("INSERT INTO users (username, email, password) VALUES (?, ?, ?)");
$stmt->execute([$username, $email, $hashed]);
$userId = $pdo->lastInsertId();

session_start();
$_SESSION['user_id'] = $userId;
$_SESSION['username'] = $username;

// Send welcome email
require_once __DIR__ . '/../email/send.php';

$welcomeHtml = "
<div style='font-family: \"Baloo 2\", cursive; max-width: 500px; margin: 0 auto; padding: 20px; background: linear-gradient(145deg, #ffd9e8, #ffe0f0); border-radius: 30px; border: 3px solid white;'>
    <h1 style='color: #3a1a32; text-align: center;'>☁️ Cloud Capsule</h1>
    <h2 style='color: #4a1e3a;'>Hello $username! ✨</h2>
    <p style='color: #552a45; font-size: 1.1rem;'>Welcome to Cloud Capsule — your personal time capsule in the clouds.</p>
    <p style='color: #552a45;'>Start by creating your first capsule. Seal it with photos, letters, secrets, or songs.</p>
    <div style='text-align: center; margin: 30px 0;'>
        <a href='https://cloudcapsule.unaux.com' style='background: #b07a9a; color: white; padding: 12px 30px; text-decoration: none; border-radius: 50px; font-weight: bold; border: 2px solid white; display: inline-block;'>Create Your First Capsule</a>
    </div>
    <p style='color: #552a45; font-size: 0.9rem; margin-top: 20px;'>✨ Your memories are safe in the clouds</p>
</div>";

sendEmail($email, $username, '✨ Welcome to Cloud Capsule!', $welcomeHtml);

echo json_encode([
    'success' => true,
    'user' => ['id' => $userId, 'username' => $username, 'email' => $email]
]);
?>