<?php
header('Content-Type: application/json');
session_start();
require_once '../config/database.php';

if (!isset($_SESSION['user_id'])) {
    http_response_code(401);
    echo json_encode(['error' => 'Not logged in']);
    exit;
}

$user_id = $_SESSION['user_id'];

$stmt = $pdo->prepare("
    SELECT id, title FROM capsules
    WHERE user_id = ? AND open_date <= NOW()
    ORDER BY open_date DESC
");
$stmt->execute([$user_id]);
$opened = $stmt->fetchAll(PDO::FETCH_ASSOC);

echo json_encode($opened);