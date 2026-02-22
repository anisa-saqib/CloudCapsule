<?php
header('Content-Type: application/json');
session_start();

if (!isset($_SESSION['user_id'])) {
    http_response_code(401);
    echo json_encode(['error' => 'Not logged in']);
    exit;
}

echo json_encode(['user' => ['id' => $_SESSION['user_id'], 'username' => $_SESSION['username']]]);